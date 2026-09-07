# Learning Log

A running record of what this project taught me, written so I can **recreate
every step without help** and understand *why* each piece exists — not just
which commands to type.

Two sections:

- **[Refresher](#refresher)** — things I knew before and needed to knock the rust off.
- **[New Material](#new-material)** — things I hadn't done before.

---

# Refresher

## Git: creating a repository from scratch

### The mental model

Git is **distributed**. My laptop holds a complete repository — full history,
every commit. GitHub is not "where the code lives"; it's just *another copy*
I've agreed to sync with. This is why I can commit on a plane.

A change lives in one of four places, and every core command moves it between them:

```
  working tree          staging area           local repo            remote
  (your files)   ──add──▶  (the index)  ──commit──▶  (history)  ──push──▶  (GitHub)
```

The staging area is the part that feels odd coming back to git. It exists so a
commit can be *assembled* — you can stage three of five changed files and commit
just those. `git add` doesn't save anything; it marks what the next commit will contain.

### Creating the repository

```bash
mkdir my-project && cd my-project
git init
```

`git init` creates a hidden `.git/` directory. **That directory is the repository** —
the entire history database. Delete it and you have plain files; everything else in
the folder is just your working tree.

### Setting identity

Every commit records an author. Git refuses to commit without one.

```bash
git config --global user.name "Oryem Kilama"
git config --global user.email "me@example.com"
```

| Flag | Writes to | Applies to |
|---|---|---|
| `--global` | `~/.gitconfig` | every repo on the machine |
| *(none)* | `.git/config` | **this repo only** — overrides global |

Repo-local config is useful when one project needs a different identity than
the default. That's exactly what I used for the email privacy fix below.

### Email privacy on public repos

Commits carry your email address, and **public repos expose it to scrapers**.
GitHub provides a free alias:

```
{user-id}+{username}@users.noreply.github.com
```

Find your numeric user ID:

```bash
gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'
```

Then set it (globally, or per-repo as I did):

```bash
git config user.email "157544408+okoryem@users.noreply.github.com"
```

GitHub still links those commits to your account and they still count on the
contribution graph — the address is just an alias.

**If a commit already has the wrong email**, and you haven't pushed yet:

```bash
git commit --amend --reset-author --no-edit
```

`--reset-author` rewrites the author to your *current* config. Verify with:

```bash
git log --all --format='%ae' | sort -u
```

⚠️ **Only amend commits you haven't pushed.** Amending creates a *new* commit
with a new hash. If others have pulled the old one, you've split history and
they'll have a bad day.

### What not to commit

```gitignore
/node_modules      # regenerable from package.json — and enormous
/.next             # build cache
/out               # build output
.env*              # secrets, always
```

In this project: **756MB of dependencies vs 1.4MB of actual source.** Everything
ignored can be rebuilt with `npm install`. Committing build artifacts bloats the
repo permanently — git keeps every version of every file forever.

Before publishing anything, check for secrets:

```bash
git ls-files | xargs grep -lEi 'AKIA[0-9A-Z]{16}|secret[_-]?key|password|BEGIN .*PRIVATE KEY'
```

### First commit

```bash
git add -A                        # stage everything (respects .gitignore)
git commit -m "Initial commit"
```

Check what you're about to commit before you do:

```bash
git status --short                # M = modified, A = added, ?? = untracked
git diff --cached                 # the exact staged changes
```

### Connecting to GitHub

Three things must happen: a repo has to exist remotely, the local repo needs to
know its address, and the commits have to be uploaded.

**The explicit way** — worth doing once to see the pieces:

```bash
# 1. Create an empty repo on GitHub
gh repo create travel-site --public

# 2. Register that URL locally under the name "origin"
git remote add origin https://github.com/USER/travel-site.git

# 3. Upload, and set upstream tracking
git push -u origin main
```

**The shortcut** — all three at once:

```bash
gh repo create travel-site --public --source=. --remote=origin --push
```

Two things worth knowing:

- **`origin` is just a name.** Nothing magic — it's the conventional label for
  the primary remote. You could call it `github`.
- **`-u` sets upstream tracking.** It links local `main` to `origin/main`. This
  is why `git status` can say "up to date with origin/main", and why every push
  after this is a bare `git push` with no arguments.

Verify:

```bash
git remote -v          # where origin points
git status -sb         # first line shows ## main...origin/main
```

### The daily loop

```bash
git status             # what changed
git add -A             # stage it
git commit -m "..."    # save it locally
git push               # send to GitHub
```

### Commands worth remembering

| Command | What it does |
|---|---|
| `git log --oneline` | compact history |
| `git log --stat` | history plus which files changed |
| `git diff` | unstaged changes |
| `git diff --cached` | staged changes |
| `git restore <file>` | discard unstaged changes to a file |
| `git restore --staged <file>` | unstage, keep the edit |

### Gotcha I hit

**zsh doesn't word-split unquoted variables like bash does.** This silently fails:

```bash
P="--profile travel-site"
aws s3 ls $P            # zsh passes ONE argument: "--profile travel-site"
```

Use `${=P}` in zsh, or better, use environment variables:

```bash
export AWS_PROFILE=travel-site
aws s3 ls
```

---

# New Material

## AWS

Everything below was new to me. It's ordered the way I'd do it again from scratch.

### 1. The identity model — three kinds of "user"

This is the concept everything else rests on, and it isn't obvious from outside.

| | What it is | When to use it |
|---|---|---|
| **Root user** | The email you signed up with. Unlimited power — can close the account, change billing, delete anything. Cannot be restricted. | Almost never. Initial setup, then leave it alone. |
| **IAM user** | A user *inside* the account, with permissions you define. Traditionally authenticated with an access key. | Legacy. Avoid for humans. |
| **IAM Identity Center** | A directory of humans, mapped to accounts and roles. Issues **temporary** credentials. | This is the modern answer for people. |

The rule: **secure root, then stop using it.** Everything day-to-day happens
through Identity Center.

### 2. Securing the root user

Sign in at `console.aws.amazon.com` with the signup email.

**Enable MFA:** account menu (top right) → **Security credentials** →
**Multi-factor authentication** → *Assign MFA device*. Choose a **passkey**
(Touch ID) or an authenticator app.

**Allow non-root users to see billing:** account menu → **Account** → scroll to
**IAM user and role access to billing information** → *Edit* → **Activate**.

Easy to miss, and without it only root can see the bill — including the admin
user you're about to create.

### 3. Budget alarms — do this before deploying anything

AWS bills by usage with **no default ceiling**. Nothing stops a mistake from
running all month. Budgets don't cap spending, but they tell you fast.

**Billing and Cost Management** → **Budgets** → *Create budget*:

| Budget | Purpose |
|---|---|
| **Zero spend budget** (template) | Alerts on *any* charge. Tells you something started costing money. |
| **Monthly cost budget**, $10, alert at 80% actual + 100% forecasted | Tells you it's getting serious. |

Verify from the CLI later:

```bash
aws budgets describe-budgets --account-id YOUR_ACCOUNT_ID \
  --query 'Budgets[].{Name:BudgetName,Limit:BudgetLimit.Amount}' --output table
```

**The costs that surprise people** are always something *running*, not something
stored:

| Trap | Cost |
|---|---|
| NAT Gateway left in a VPC | **~$32/mo doing nothing** |
| EC2 instance from an old tutorial | $8–70/mo |
| Unattached Elastic IP | ~$3.60/mo |
| RDS database | $15+/mo |

A purely static site has **none of these**. Nothing runs; files just sit there.

### 4. Credentials without access keys

**The thing to avoid:** `aws configure` generates a permanent access key pair
and writes it to `~/.aws/credentials` in plaintext. Those keys never expire. If
one reaches a public repo, bots find it in minutes — that's the origin of every
"$40,000 AWS bill" story.

**IAM Identity Center instead** issues credentials that expire in hours and are
refreshed from the browser. Nothing permanent touches the disk.

#### Setting it up (console)

1. Search **IAM Identity Center** → *Enable*
   - **Pick your region deliberately** — it can't be changed later without
     tearing the whole thing down. I used `us-east-1`.
   - It creates an AWS Organization if you don't have one. Expected, and free.
2. **Users** → *Add user* — username, email, name.
3. **Permission sets** → *Create permission set* → **Predefined** →
   **AdministratorAccess**.
4. **AWS accounts** → tick your account → *Assign users or groups* → pick the
   user + the permission set.
5. Accept the emailed invitation, set a password, **enable MFA on this user too**.

From the dashboard, copy the **AWS access portal URL**:
`https://d-XXXXXXXXXX.awsapps.com/start`

#### Connecting the CLI

Write `~/.aws/config` directly — fewer things to mistype than the interactive
`aws configure sso`:

```ini
[sso-session travel-site]
sso_start_url = https://d-XXXXXXXXXX.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile travel-site]
sso_session = travel-site
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
region = us-east-1
output = json
```

Then log in — this opens a browser:

```bash
aws sso login --sso-session travel-site
```

Verify:

```bash
aws sts get-caller-identity --profile travel-site
```

The ARN should read `assumed-role/AWSReservedSSO_AdministratorAccess_.../username`.
**`assumed-role` is the confirmation** — these are temporary session credentials,
not a permanent key.

#### Two files, and why only one exists

| File | Contents | Should exist? |
|---|---|---|
| `~/.aws/config` | Profiles, regions, SSO settings. No secrets. | ✅ yes |
| `~/.aws/credentials` | **Permanent access keys, plaintext.** | ❌ **should not exist** |

Confirm the dangerous one is absent:

```bash
ls ~/.aws/credentials    # want: "No such file or directory"
```

#### Credentials expire — this is a feature

When AWS commands start failing with auth errors, nothing is broken:

```bash
aws sso login --sso-session travel-site
```

Setting the profile once per shell saves repeating `--profile`:

```bash
export AWS_PROFILE=travel-site
```

### 5. S3 — object storage

Buckets hold objects (files). Flat key-value storage, not a real filesystem —
"folders" are just `/` characters in key names.

Two buckets in this project, deliberately configured differently:

| | Site bucket | Media bucket |
|---|---|---|
| Holds | the built site (`out/`) | graded video, posters |
| Rebuildable? | yes, from source | **no — irreplaceable** |
| Removal policy | `DESTROY` | `RETAIN` |
| Versioning | off | **on** |

**Why they differ:** `cdk destroy` deletes everything in the stack. The site
bucket can be rebuilt with one command, so losing it is fine. The video is not
in git and cannot be regenerated — so it's set to survive the stack being
deleted, and versioning protects against overwriting a file by accident.

That's the general principle: **removal policy should match how replaceable the
data is**, not what's convenient.

**Both buckets are private.** No public access, no bucket website hosting. The
only way in is through CloudFront (next section). A public bucket can be scraped,
and scraped video is unbounded egress billed to you.

```bash
aws s3 ls                                  # list buckets
aws s3 ls s3://bucket-name --recursive     # list objects
aws s3 sync out/ s3://bucket-name/ --delete  # upload, removing what's gone
```

`--delete` makes the bucket **match** the local folder rather than accumulating
orphaned files from previous deploys.

### 6. CloudFront — the CDN

CloudFront caches your files at edge locations worldwide, so a viewer in Tokyo
gets a copy from Tokyo rather than Virginia. For video this is the difference
between working and not.

It also does three things beyond speed:

1. **HTTPS for free**, with a certificate AWS manages
2. **Keeps S3 private** via Origin Access Control
3. **Free tier: 1TB/month egress + 10M requests** — perpetual, not a trial

#### Origin Access Control (OAC)

The old way to serve S3 through a CDN was to make the bucket public. OAC
replaces that: CloudFront signs its requests to S3, and a bucket policy accepts
requests **only** from that specific distribution.

Result: the S3 URL returns **403 Forbidden** to everyone, forever. The only
route to the file is through the CDN. Verify it:

```bash
curl -sI https://BUCKET.s3.amazonaws.com/index.html   # want 403
curl -sI https://DISTRIBUTION.cloudfront.net/         # want 200
```

#### The directory index problem

This one cost real debugging time and isn't documented obviously.

Next.js with `trailingSlash: true` emits `/clips/hanoi/index.html`. A browser
requests `/clips/hanoi/`. **CloudFront's `defaultRootObject` only applies at the
root `/`** — for any deeper path it passes the URI straight to S3, which has no
concept of a directory index. Result: 404 on every page except the homepage.

The fix is a **CloudFront Function** — tiny JavaScript that runs at the edge on
every request:

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
```

Free tier covers 2M invocations/month. **`trailingSlash: true` and this function
are a matched pair** — changing one without the other breaks routing.

#### Cache invalidation

CloudFront caches aggressively. After a deploy, edges keep serving the old
version until the TTL expires — which looks exactly like a deploy that silently
failed.

```bash
aws cloudfront create-invalidation --distribution-id ABC123 --paths "/*"
```

First 1,000 paths per month are free. `/*` counts as one path.

### 7. Infrastructure as Code with AWS CDK

**The problem with clicking in the console:** six months later nobody knows what
exists or why. It can't be reviewed, diffed, or recreated.

**CDK** lets you define infrastructure in TypeScript. It compiles to
CloudFormation (AWS's native JSON/YAML format), which AWS then executes.

```
TypeScript  ──cdk synth──▶  CloudFormation JSON  ──cdk deploy──▶  real resources
```

Writing real TypeScript means types, autocomplete, loops, and functions — rather
than hand-writing hundreds of lines of YAML.

#### Bootstrapping

Once per account+region, before the first deploy:

```bash
cd infra && npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

This creates a `CDKToolkit` stack — a staging bucket and IAM roles that
deployments use to upload assets. One-time setup, not part of your app.

#### The workflow

```bash
npx cdk synth     # generate CloudFormation, catch errors locally — costs nothing
npx cdk diff      # what would change vs. what's deployed — ALWAYS run this first
npx cdk deploy    # apply
npx cdk destroy   # tear down (respects RemovalPolicy)
```

`cdk diff` is the habit worth building. It's the difference between knowing and
hoping.

#### CDK is installed per-project, not globally

```bash
npx cdk deploy      # uses the version pinned in infra/package.json
```

A global install means your machine and CI can run different versions and
produce different results. Pinning it in `package.json` makes builds reproducible.

#### Reading what a stack will create

```bash
python3 -c "
import json; d=json.load(open('cdk.out/TravelSiteStack.template.json'))
for k,v in sorted(d['Resources'].items(), key=lambda x: x[1]['Type']):
    print(f\"{v['Type']:<45} {k}\")
"
```

### 8. The deploy pipeline

Three steps, every time:

```bash
npm run build                              # 1. Next.js → out/
aws s3 sync out/ s3://BUCKET/ --delete     # 2. upload
aws cloudfront create-invalidation ...     # 3. clear the edge cache
```

Wrapped in `scripts/deploy.sh` as `npm run deploy`.

**Key design choice:** the script reads the bucket name and distribution ID from
**CloudFormation stack outputs** rather than hardcoding them:

```bash
aws cloudformation describe-stacks --stack-name TravelSiteStack \
  --query 'Stacks[0].Outputs' --output json
```

Two benefits: no account-specific values in a public repo, and the script cannot
drift out of sync if the infrastructure is recreated with new bucket names.

### 9. Verifying a deploy

Don't trust "it deployed" — check behavior:

```bash
URL="https://XXXX.cloudfront.net"

curl -s -o /dev/null -w "%{http_code}\n" "$URL/"                 # 200
curl -s -o /dev/null -w "%{http_code}\n" "$URL/some/path/"       # 200 → rewrite works
curl -s -o /dev/null -w "%{http_code}\n" "$URL/does-not-exist/"  # 404 → error mapping works
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://BUCKET.s3.amazonaws.com/index.html"                   # 403 → bucket is private
```

That last check is the important one. **A 200 there means the bucket is public
and anyone can bypass your CDN**, billing you directly for S3 egress.

---

## Recreate this from scratch

The whole thing, in order, with no AI help.

**Local tooling**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile && eval "$(/opt/homebrew/bin/brew shellenv)"
brew install node awscli ffmpeg gh
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
git config --global init.defaultBranch main
gh auth login
```

**AWS console** *(browser — can't be scripted)*

1. Create account → **MFA on root**
2. Activate IAM/role access to billing information
3. Budgets: zero-spend + $10 monthly
4. IAM Identity Center → enable (**pick region carefully**) → user →
   `AdministratorAccess` permission set → assign → accept invite → MFA
5. Copy the access portal URL

**Connect the CLI**

```bash
mkdir -p ~/.aws && cat > ~/.aws/config <<'EOF'
[sso-session travel-site]
sso_start_url = https://d-XXXXXXXXXX.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access
EOF
aws sso login --sso-session travel-site
# add the [profile] block with account id + role, then:
aws sts get-caller-identity --profile travel-site
```

**Project**

```bash
mkdir -p ~/Projects/travel-site && cd ~/Projects/travel-site && git init
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack --yes
# set output:'export', images.unoptimized, trailingSlash in next.config.ts
mkdir infra && cd infra && npx cdk init app --language typescript
# write the stack, then:
npx cdk bootstrap && npx cdk deploy
cd .. && npm run deploy
gh repo create travel-site --public --source=. --remote=origin --push
```

**Sanity sweep — catch anything unexpectedly billing**

```bash
export AWS_PROFILE=travel-site
aws ec2 describe-instances    --query 'Reservations[].Instances[].InstanceId' --output text
aws ec2 describe-nat-gateways --query 'NatGateways[].NatGatewayId'            --output text
aws ec2 describe-addresses    --query 'Addresses[].PublicIp'                  --output text
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'    --output text
```

All empty = nothing running = no surprise bill.
