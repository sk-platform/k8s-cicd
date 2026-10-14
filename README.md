# k8s-cicd

The practical demo for [From branch to production: multi-env deployment
automation][blog].

The post explains the design: why merging to `main` should not deploy, why
production promotes an image instead of building one, and how one deploy job
can serve every environment. This repo runs that design as real GitHub Actions
workflows you can trigger and watch.

There is a small Next.js app in here, but only so the pipelines have something
to build and ship. The app is not the point.

[blog]: https://sk-santhosh.info/blogs/from-branch-to-production-multi-env-deployment-automation

## The flow

```
push any branch        ──►  ci.yml                 lint, typecheck, test, build, codeql
open a pull request    ──►  merge-preview.yml      verify the PR merged with the current base
merge to main          ──►  release-drafter.yml    draft release bumped, nothing deployed
publish the draft      ──►  release-deploy.yml     build.yml (vX.Y.Z) ──► deploy.yml (staging)
promote, by hand       ──►  deploy.yml             that same image ──► production, behind approval
pick a dev namespace   ──►  build-and-deploy.yml   tag ──► build.yml ──► deploy.yml (dev0..dev3)
```

Two things in that picture matter more than the rest.

**Merging to `main` deploys nothing.** It only keeps a draft release in step
with what has landed. Publishing the draft is a person deciding to ship, and
that is the event which creates the tag.

**Production does not build.** It promotes. `release-deploy.yml` builds one
image from the release tag, staging runs it, and promoting to production hands
`deploy.yml` that same tag. The bytes that ship are the bytes that were tested.

## Workflows

| File | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | push to any branch | lint, typecheck, test, build, CodeQL |
| `merge-preview.yml` | pull request | verifies the PR merged with the current base |
| `release-drafter.yml` | push to `main` | updates the draft release |
| `release-deploy.yml` | release published | calls `build.yml`, then deploys to staging |
| `build-and-deploy.yml` | manual | picks a tag, then calls `build.yml` and `deploy.yml` |
| `build.yml` | called, or manual | builds and pushes the image for a given tag |
| `deploy.yml` | called, or manual | the rollout itself, for every environment |

The last two are the only places an image gets built or a rollout happens, and
everything else is a caller. That split is the point: one build path and one
deploy path to read and change, instead of a copy per trigger that quietly
drifts.

`build.yml` takes a tag and pushes `ghcr.io/<repo>:<tag>`. It does not care
where the tag came from, so a release and a dev deploy produce their images
identically. It hands the full image reference back as an output.

`deploy.yml` takes an image reference and never builds. It works out the Argo
CD app name (`{service}-{environment}`), works out which runner pool the
environment needs, and runs inside the matching GitHub Environment so
approvals apply.

`build-and-deploy.yml` is what decides a tag. Give it a version and it uses
that; leave the version blank and it uses the short commit SHA.

```bash
# promote to production, no rebuild
gh workflow run deploy.yml \
  -f service=k8s-cicd \
  -f environment=production \
  -f image=ghcr.io/sk-platform/k8s-cicd:v1.0.0
```

Every release run prints that command, filled in, in its job summary.

## Triggers and environments

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

## Images

Everything goes to `ghcr.io/sk-platform/k8s-cicd`. The package appears on the
first push and starts out private.

| Triggered by | Tag |
| --- | --- |
| `build-and-deploy.yml`, no version given | the short commit SHA |
| `build-and-deploy.yml`, version given | that version |
| a published release | the release tag, plus `latest` |

Dev tags are disposable, because dev images are rebuilt constantly and are
never promoted. Release tags are permanent and match the git tag, which is what
makes a promotion to production a tag reference rather than a rebuild.

## Versions

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

## Reading the runs

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

## Trying it

```bash
git switch -c try/something
# change anything
git commit -am "try something"
git push -u origin try/something     # ci.yml runs
gh pr create                         # merge-preview.yml runs
gh pr merge --merge                  # release-drafter.yml updates the draft
gh release edit v1.0.1 --draft=false # release-deploy.yml builds and ships to staging
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

## The app, briefly

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
