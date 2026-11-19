# workers/scene-check: the scene engine's checks over HTTP, with Chromium for keyframes.
# Reachable only on Fly's private network. Built from the repository root: see docs/deploy.md.
# The base image's Playwright version must match workers/scene-check/package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

ENV PNPM_HOME=/pnpm \
    CI=1 \
    SCENE_CHECK_HOST=:: \
    SCENE_CHECK_PORT=8320 \
    SCENE_CHECK_CHROMIUM_SANDBOX=1
ENV PATH="${PNPM_HOME}:${PATH}"
# The pnpm version in package.json's packageManager field.
RUN npm install --global pnpm@10.6.5

WORKDIR /app

# Manifests first, so a code change does not reinstall dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY workers/scene-check/package.json workers/scene-check/package.json
COPY packages/scenes/package.json packages/scenes/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter "@eddy/scene-check..."

COPY workers/scene-check workers/scene-check
COPY packages/scenes packages/scenes
COPY packages/schemas packages/schemas
# The scenes read the design tokens and fonts from the UI package.
COPY packages/ui packages/ui

# The image's own unprivileged user, so Chromium's sandbox can run.
USER pwuser
EXPOSE 8320
CMD ["pnpm", "--filter", "@eddy/scene-check", "serve"]
