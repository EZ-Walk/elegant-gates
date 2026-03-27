# Mapbox Token Build Error

## Problem

Map frontend loads but displays a blank map with no tiles. The browser console may show Mapbox GL authentication errors.

## Root Cause

The `VITE_MAPBOX_TOKEN` environment variable was not available during the Vite build process. Vite requires build-time environment variables to be available when running `npm run build`, but the Docker container configuration was only passing runtime environment variables.

## Error Symptoms

1. Map container starts successfully
2. API endpoints respond correctly
3. Frontend loads but map tiles fail to load
4. Browser console shows Mapbox authentication errors
5. No Mapbox token visible in the built JavaScript bundle

## Technical Details

### Initial Configuration Issues

The original setup had several configuration problems:

1. **Missing VITE_MAPBOX_TOKEN in .env**: Only `MAPBOX_TOKEN` was set, but Vite requires variables prefixed with `VITE_`
2. **No build arguments in Dockerfile**: Environment variables weren't passed to the build stage
3. **Cached Docker layers**: Previous builds without the token were cached

### Build Process Problem

Vite embeds environment variables at build time, not runtime. The variable must be:
- Available during `npm run build`
- Prefixed with `VITE_` 
- Passed as a build argument to Docker

## Solution

### Step 1: Add VITE_MAPBOX_TOKEN to .env

```bash
echo 'VITE_MAPBOX_TOKEN=your_mapbox_token_here' >> .env
```

### Step 2: Update docker-compose.yml

Modified the map service configuration to pass build arguments:

```yaml
# Before
map:
  build: ./services/map
  environment:
    - VITE_MAPBOX_TOKEN=${MAPBOX_TOKEN}

# After  
map:
  build:
    context: ./services/map
    args:
      VITE_MAPBOX_TOKEN: ${VITE_MAPBOX_TOKEN}
  environment:
    - REDIS_URL=redis://redis:6379
    - VITE_MAPBOX_TOKEN=${MAPBOX_TOKEN}
```

### Step 3: Update Dockerfile

Added build argument support to the map service Dockerfile:

```dockerfile
# Stage 1: Build React frontend
FROM node:20-alpine AS builder
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

WORKDIR /app
# ... rest of build process
```

### Step 4: Force Rebuild

```bash
# Clear cached layers and rebuild
docker compose down
docker compose build --no-cache map
docker compose up -d
```

## Verification

After applying the fix, verify the token is embedded:

```bash
# Check if token appears in built JavaScript
docker compose exec map grep -o 'pk\.eyJ[^"]*' /app/dist/assets/index-*.js
```

Should return the Mapbox token string.

## Prevention

To avoid this error in future deployments:

1. **Document build-time vs runtime variables**: Clearly distinguish which environment variables are needed at build time
2. **Environment file templates**: Provide complete .env.example with all required variables
3. **Build verification**: Include verification steps to check that tokens are properly embedded
4. **Docker build patterns**: Use consistent patterns for passing build arguments in multi-stage builds

## Related Issues

- Vite environment variable documentation: https://vite.dev/guide/env-and-mode.html
- Docker multi-stage build arguments: https://docs.docker.com/build/building/multi-stage/

## Date

2026-03-26

## Contributors

- Claude Code (diagnosis and fix)