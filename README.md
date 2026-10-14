# k8s-cicd — multi-environment CI/CD with GitHub Actions, GHCR and Argo CD

A working GitHub Actions pipeline that builds a container image once, deploys
it to dev, staging and production through one reusable deploy workflow, and
promotes the tested image to production behind a manual approval gate instead
of rebuilding it.

[![CI](https://github.com/sk-platform/k8s-cicd/actions/workflows/ci.yml/badge.svg)](https://github.com/sk-platform/k8s-cicd/actions/workflows/ci.yml)
[![Build and deploy](https://github.com/sk-platform/k8s-cicd/actions/workflows/build-and-deploy.yml/badge.svg)](https://github.com/sk-platform/k8s-cicd/actions/workflows/build-and-deploy.yml)
[![Latest release](https://img.shields.io/github/v/release/sk-platform/k8s-cicd?sort=semver)](https://github.com/sk-platform/k8s-cicd/releases)

This is the practical demo for [From branch to production: multi-env
deployment automation][blog]. The post explains the design: why merging to
`main` should not deploy, why production promotes an image instead of building
one, and how one deploy job can serve every environment. This repo runs that
design as real GitHub Actions workflows you can trigger and watch.

There is a small Next.js app in here, but only so the pipelines have something
to build and ship. The app is not the point.

[blog]: https://sk-santhosh.info/blogs/from-branch-to-production-multi-env-deployment-automation

## What this repo shows

- **Build once, deploy many.** One `build.yml` is the only place an image is
  built, so a release and a dev deploy produce their images identically.
- **Merging to `main` deploys nothing.** It updates a draft release. Publishing
  that draft is a person deciding to ship, and that is what cuts the tag.
- **Promote, don't rebuild.** Production ships the exact image staging ran,
  passed to `deploy.yml` as a tag reference.
- **Reusable workflows.** `build.yml` and `deploy.yml` are `workflow_call`
  workflows with `workflow_dispatch` on top, so each is callable from a
  pipeline or runnable by hand.
- **One deploy path for every environment.** `dev0`–`dev3`, `staging` and
  `production` all go through the same job.
- **Manual approval before production.** GitHub Environments with a required
  reviewer hold the production rollout until someone approves it.
- **Self-hosted runner pool routing.** The deploy resolves a `nonprod` or
  `prod` pool, so only prod-labelled runners can reach the production control
  plane.
- **Semantic versioning from PR labels.** `release-drafter` works out the next
  `vX.Y.Z` from the labels on merged pull requests.
- **Container images in GHCR.** Pushed with the built-in `GITHUB_TOKEN`, no
  registry credentials to set up.
- **Checks on every push.** Lint, typecheck, test, build and a CodeQL scan,
  plus a merge preview that tests the PR merged with its current base.

## The deployment flow, trigger by trigger

```
push any branch        ──►  ci.yml                 lint, typecheck, test, build, codeql
open a pull request    ──►  merge-preview.yml      verify the PR merged with the current base
merge to main          ──►  release-drafter.yml    draft release bumped, nothing deployed
publish the draft      ──►  build-and-deploy.yml   vX.Y.Z ──► build.yml ──► deploy.yml (staging)
pick a dev namespace   ──►  build-and-deploy.yml   sha ──► build.yml ──► deploy.yml (dev0..dev3)
promote, by hand       ──►  deploy.yml             that same image ──► production, behind approval
```

Two things in that picture are worth saying twice.

**Merging to `main` deploys nothing.** It only keeps a draft release in step
with what has landed. Publishing the draft is a person deciding to ship, and
that is the event which creates the tag.

**Production does not build.** It promotes. Publishing a release builds one
image from the release tag, staging runs it, and promoting to production hands
`deploy.yml` that same tag. The bytes that ship are the bytes that were tested.

## The workflows: one build, one deploy, one caller

| File | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | push to any branch | lint, typecheck, test, build, CodeQL |
| `merge-preview.yml` | pull request | verifies the PR merged with the current base |
| `release-drafter.yml` | push to `main` | updates the draft release |
| `build-and-deploy.yml` | release published, or manual | works out the tag, then calls `build.yml` and `deploy.yml` |
| `build.yml` | called, or manual | builds and pushes the image for a given tag |
| `deploy.yml` | called, or manual | the rollout itself, for every environment |

Three workflows, each with one job to do.

`build.yml` takes a tag and pushes `ghcr.io/<repo>:<tag>`. It does not care
where the tag came from, so a release and a dev deploy produce their images
identically. It hands the full image reference back as an output.

`deploy.yml` takes an image reference and never builds. It works out the Argo
CD app name (`{service}-{environment}`), works out which runner pool the
environment needs, and runs inside the matching GitHub Environment so
approvals apply.

`build-and-deploy.yml` is the only caller of either, and both ways in go
through it, because a release and a dev deploy want the same three steps and
only disagree about what the tag is and where it lands:

| Trigger | Tag | Built from | Lands on |
| --- | --- | --- | --- |
| release published | the release tag, plus `latest` | that tag | `staging` |
| manual, version given | that version | the branch you ran it from | the dev namespace you picked |
| manual, no version | the short commit SHA | the branch you ran it from | the dev namespace you picked |

Production is deliberately not in that table. It promotes an image this
workflow already built and staging already ran, so it dispatches `deploy.yml`
on its own with no build step at all.

```bash
# promote to production, no rebuild
gh workflow run deploy.yml \
  -f service=k8s-cicd \
  -f environment=production \
  -f image=ghcr.io/sk-platform/k8s-cicd:v1.0.0
```

Every release run prints that command, filled in, in its job summary.

## Environments and the production approval gate

| Trigger | Target | How |
| --- | --- | --- |
| manual dispatch | `dev0` to `dev3` | pick the namespace as an input |
| release published | `staging` | automatic |
| manual dispatch | `production` | approval gate on the environment |

All of them are GitHub Environments. Dev and staging are created on first use
with no protection rules. `production` needs a required reviewer added by hand
under Settings, Environments; without it a production dispatch ships with no
approval step.

The blog runs deploys on self-hosted runners inside the VPC, where `nonprod`
and `prod` pools are separate so only prod-labelled runners can reach the
production control plane. `deploy.yml` works that routing out and logs it, then
runs on `ubuntu-latest`, because there is no VPC behind a demo.

## Container images in GHCR

Everything goes to `ghcr.io/sk-platform/k8s-cicd`. The package appears on the
first push and starts out private.

| Triggered by | Tag |
| --- | --- |
| a published release | the release tag, plus `latest` |
| a dispatch with a version | that version |
| a dispatch without one | the short commit SHA |

Dev tags are disposable, because dev images are rebuilt constantly and are
never promoted. Release tags are permanent and match the git tag, which is what
makes a promotion to production a tag reference rather than a rebuild.

## Automatic semantic versioning with release-drafter

`release-drafter` works out the next version from the labels on the PRs merged
since the last release.

| Label | Bump |
| --- | --- |
| `feature` | minor |
| `fix`, `chore` | patch |
| none | patch |

Tags are `vX.Y.Z`. Two things to know when setting this up on a fresh repo:
those three labels have to exist or every bump comes out as a patch, and
release-drafter has no setting for the starting version, so the first release
has to be created by hand as `v1.0.0`. After that it bumps from the last
release.

## Workflow annotations and job summaries

Each workflow annotates itself instead of leaving you to scroll a raw log:

| Command | Used for |
| --- | --- |
| `::group::` | folding the merge, the resolved target, the printed Argo CD calls |
| `::notice::` | the draft that is ready, the image that was pushed, the rollout that finished |
| `::warning::` | a production rollout clearing its approval gate |
| `::error::` | a merge conflict or a failed check, titled so it shows on the run |
| `::add-mask::` | the Argo CD credential |
| `$GITHUB_STEP_SUMMARY` | a table on every run: what was checked, what was built, where it went |
| `$GITHUB_OUTPUT` | passing the image reference from a build job to the deploy job |

## What is real here, and what is not

Real: the triggers, the draft release and version resolution, the image build
and push to GHCR, the GitHub Environments and the production approval gate, the
runner pool routing, and the merge preview actually merging the base branch.

Printed, not run: the `argocd login`, `set`, `sync` and `wait` calls at the end
of a deploy. There is no cluster behind this repo, so `deploy.yml` echoes them
with the arguments it would have used.

Swapped out: the blog builds to ECR on AWS and syncs a private Argo CD inside a
VPC. This uses GHCR and `GITHUB_TOKEN`, so the repo stands alone with no cloud
account to set up.

## Trying it end to end

```bash
git switch -c try/something
# change anything
git commit -am "try something"
git push -u origin try/something     # ci.yml runs
gh pr create                         # merge-preview.yml runs
gh pr merge --merge                  # release-drafter.yml updates the draft
gh release edit v1.0.1 --draft=false # builds the tag, ships it to staging
```

Then promote the image it built with the `gh workflow run deploy.yml` command
above, and watch the production job wait for an approval.

A dev deploy needs no release at all:

```bash
gh workflow run build-and-deploy.yml -f environment=dev1
gh workflow run build-and-deploy.yml -f environment=dev1 -f version=v1.2.0-rc1
```

Or build a tag without deploying it anywhere:

```bash
gh workflow run build.yml -f tag=v1.0.0 -f ref=v1.0.0
```

## The app (an India in-hand salary calculator), briefly

A salary calculator: slide an annual CTC and it shows PF, professional tax,
income tax and what lands in hand. It exists to give the pipelines a real build
and a real test suite to run.

```bash
npm install
npm run dev        # needs Node 24 or newer, pinned in .nvmrc
npm run verify     # lint, typecheck, test: what the hook and CI run
docker build -t k8s-cicd . && docker run --rm -p 3000:3000 k8s-cicd
```

`.githooks/pre-commit` runs the same checks before a commit and blocks it on
failure. `npm install` wires it up through the `prepare` script. Skip it with
`git commit --no-verify`.

## FAQ

**How do I deploy to multiple environments with one GitHub Actions workflow?**
Make the rollout a `workflow_call` workflow that takes the environment as an
input, and set `environment: ${{ inputs.environment }}` on the job. That is all
of `deploy.yml`: one code path for `dev0`–`dev3`, `staging` and `production`,
instead of a workflow per environment.

**How do I stop a merge to `main` from deploying?**
Do not put `push: branches: [main]` on the deploy. Here, merging to `main` only
runs `release-drafter.yml`, which updates a draft release. The deploy triggers
on `release: types: [published]`, so shipping is a deliberate act.

**How do I promote the same image to production without rebuilding it?**
Keep the build and the deploy in separate workflows, have the build return the
full image reference as a `workflow_call` output, and have production dispatch
the deploy with that reference. `deploy.yml` has no build step at all, so a
production rollout cannot accidentally produce new bytes.

**How do I require manual approval before a production deploy in GitHub Actions?**
Add a required reviewer to the `production` GitHub Environment under Settings,
Environments. Any job with `environment: production` then waits for that
approval before its first step runs. Without the reviewer configured, the job
ships straight through.

**How do I version releases automatically from pull request labels?**
`release-drafter` with a `version-resolver`. Here `feature` bumps the minor,
`fix` and `chore` bump the patch, and anything unlabelled is a patch. The
labels have to exist in the repo or every bump resolves to a patch, and the
first release has to be created by hand as `v1.0.0`.

**How do I route a deploy to a self-hosted runner pool per environment?**
Resolve the pool in a step and use it in `runs-on`. `deploy.yml` works out
`prod` for production and `nonprod` for everything else, which is how a real
platform keeps the production control plane reachable only from prod-labelled
runners inside the VPC.

**Do I need Kubernetes or Argo CD to run this?**
No. The `argocd login`, `set`, `sync` and `wait` calls are printed with the
arguments they would have used, because there is no cluster behind a demo repo.
Everything else — the triggers, the versioning, the image build and push to
GHCR, the environment gate, the runner routing — actually runs.

**Can I use this with ECR, or with Docker Hub, instead of GHCR?**
Yes. `build.yml` is the only place that logs in and pushes, so swapping the
registry is a change to one job. The blog version of this pipeline builds to
ECR on AWS; this repo uses GHCR so it stands alone with no cloud account.

## Related

GitHub Actions multi-environment deployment · build once deploy many ·
reusable workflows (`workflow_call`) · promote a container image to production
· GitHub Environments approval gate · release-drafter semantic versioning ·
GHCR image publishing · Argo CD sync from CI · self-hosted runner pools ·
Kubernetes CI/CD pipeline example.

## License

[MIT](LICENSE). Copy any of it into your own pipeline.
