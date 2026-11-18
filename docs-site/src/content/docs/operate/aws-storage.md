---
title: AWS S3 storage and workload identity
description: Configure S3 storage for Xberg on AWS, with IRSA, EKS Pod Identity, static credentials or S3-compatible endpoints.
sidebar:
  order: 4
---

**Available in:** Pro, Enterprise

This configuration is shared by Xberg Pro and Xberg Enterprise. Workload identity (IRSA, EKS Pod Identity, ECS container credentials and EC2 IMDSv2) needs a release that includes AWS workload identity support. Earlier Pro images need static S3 credentials, so check the release notes of the image you deploy before relying on it.

## Configure S3

Set `STORAGE_PROVIDER=s3`, `STORAGE_BUCKET` to your bucket, and an AWS region such as `STORAGE_REGION=eu-west-2`. Leave `S3_ENDPOINT` unset for AWS S3. Do not keep a GCP region such as `us-central1` when you switch providers.

The region is resolved once at startup, in this order:

1. `STORAGE_REGION`
2. `S3_REGION`
3. `AWS_REGION`
4. `AWS_DEFAULT_REGION`
5. The selected profile's `region` in `AWS_CONFIG_FILE` (default `~/.aws/config`)

`AWS_PROFILE` selects the shared profile, and `default` is used otherwise. A missing region fails startup. Default S3 endpoints distinguish the commercial, China, GovCloud and European Sovereign Cloud partitions, and bucket identities remain distinct between partitions.

For workload identity, omit `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_SESSION_TOKEN`. The provider then obtains temporary credentials from the standard AWS environment, a shared static profile, an IRSA web identity token, container credentials or EC2 IMDSv2. Session tokens are included in signed requests and presigned URLs, and expiring role credentials refresh. Do not inject empty `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` values into a workload identity pod.

An explicit `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` pair takes priority. Set `S3_SESSION_TOKEN` with that pair for temporary explicit credentials. An unrelated `AWS_SESSION_TOKEN` is never combined with an explicit S3 pair. Partial explicit pairs and orphan S3 session tokens fail startup.

For the standard AWS environment provider, use the complete `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` pair with an optional `AWS_SESSION_TOKEN`. Shared static profiles use `aws_access_key_id`, `aws_secret_access_key` and an optional `aws_session_token`. The credentials-file section takes priority over the config-file section, and individual keys are not combined across files. A region-only profile can still use workload credentials.

## Presigned URL expiry

`STORAGE_PRESIGN_TTL_SECS` sets the maximum URL lifetime in seconds (default `3600`). Temporary AWS credentials can shorten it: upload and download URLs are capped below the signing credential's remaining lifetime. A one-hour role session cannot cover a full one-hour URL after time has passed since the credential was issued.

Use the expiry the API returns instead of assuming the configured maximum, and request a fresh URL when it expires. Workload credentials support direct S3 PUT and GET and presigned PUT and GET, so long-lived keys are not required for either path.

## EKS Pod Identity with Pro

Install the EKS Pod Identity Agent and create the association between an IAM role and the workload's Kubernetes service account. Do both outside the chart. The role needs permission for the configured bucket and object prefix. AWS injects `AWS_CONTAINER_CREDENTIALS_FULL_URI` and `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE`, so do not replace them with static keys. See [AWS's Pod Identity flow](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-how-it-works.html).

Merge this overlay into your normal Pro values, which already hold your image, database, license and secrets:

```yaml
serviceAccount:
  create: false
  name: extraction-storage
configMap:
  STORAGE_PROVIDER: s3
  STORAGE_BUCKET: example-extraction-bucket
  STORAGE_REGION: eu-west-2
networkPolicy:
  extraEgress:
    - to:
        - ipBlock:
            cidr: 169.254.170.23/32
      ports:
        - protocol: TCP
          port: 80
```

The egress exception is needed when the chart's NetworkPolicy is enabled, because its public internet rule excludes link-local addresses. Add only the credential-agent destination your cluster uses. For an IPv6 Pod Identity endpoint the address is `fd00:ec2::23/128`. The example does not open access to the EC2 node metadata endpoint. The public HTTPS egress rule already permits S3, but private VPC endpoints may need their own narrow rule.

The Pro chart reads its existing `secrets.name` Secret through `envFrom`. Pod Identity needs no S3 key fields in that Secret, but the other required application secrets remain necessary.

## IRSA

Configure the cluster OIDC provider, the role trust policy and the service-account annotation outside the application. For Pro, use the existing annotation surface:

```yaml
serviceAccount:
  create: true
  name: extraction-storage
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::000000000000:role/example-storage
configMap:
  STORAGE_PROVIDER: s3
  STORAGE_BUCKET: example-extraction-bucket
  STORAGE_REGION: eu-west-2
```

Replace the example role ARN with your role. EKS supplies `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`. The token file must be readable by the container's non-root user, and regional STS and S3 HTTPS connectivity are required. See [AWS's IRSA setup](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html).

## Enterprise and other runtimes

Set the same storage variables on every enabled component that accesses the bucket. Enterprise uses each component's `.env` map for non-secret values and `.extraEnv` and `.extraEnvFrom` for secrets, for example `api.env` and `worker.env`. Set `STORAGE_REGION` explicitly on each component when you change the provider. Components have their own service-account and network-policy settings, so configure the workload's actual service account and narrowly scoped metadata egress as needed.

For explicit temporary credentials, a component's secret-reference override can supply `S3_SESSION_TOKEN`:

```yaml
api:
  extraEnv:
    - name: S3_SESSION_TOKEN
      valueFrom:
        secretKeyRef:
          name: example-storage-credentials
          key: S3_SESSION_TOKEN
```

Supply the paired S3 access and secret keys through the same surface, and repeat it for every consumer. A Secret on the API pod does not populate the worker pod. See [Enterprise on Kubernetes](/start/enterprise-helm/) and [Pro on Kubernetes](/start/pro-helm/) for the full installs.

ECS container credentials and EC2 IMDSv2 use the same storage configuration without S3 static keys. Container credentials prefer `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` over the full URI, and the authorization token file over the inline token. Token files are reread when credentials refresh. Credential URLs must contain no secrets, because DEBUG diagnostics can include the endpoint URL. Use `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` for authorization. Set `AWS_EC2_METADATA_DISABLED=true` when node credentials must never be used; the setting accepts only `true` or `false`. Rejected IRSA or container credentials and incomplete static pairs fail without falling through to a node role.

For Docker Compose, override the service's storage environment with `STORAGE_PROVIDER`, `STORAGE_BUCKET` and `STORAGE_REGION`, and expose the selected credential source to the container. A container outside EKS does not acquire Pod Identity merely by setting those three variables.

## S3-compatible endpoints

For RustFS or another S3-compatible service, keep your explicit key pair, `S3_ENDPOINT`, signing region and addressing style. Custom endpoints require `STORAGE_ENDPOINT_ALLOWLIST` and must pass endpoint validation, including DNS and IP checks. See [Object storage configuration](/operate/storage/). Private object stores need an approved destination and a network egress rule.

Endpoint precedence is `S3_ENDPOINT`, `AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL`, `AWS_ENDPOINT`, then `AWS_S3_ENDPOINT`. The selected endpoint is frozen before validation and client construction, so later environment changes cannot redirect the client.

## Limits

SSO and `credential_process` profiles are outside the supported credential sources, and shared-profile role-assumption chains are not supported. Treat this implementation as a focused S3 credential provider, not as full AWS SDK parity.
