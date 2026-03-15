**home-assistant-hakit-dashboard** — Personal Home Assistant dashboard project built with React and [ha-component-kit](https://github.com/shannonhochkins/ha-component-kit) (HAKit). Shared for **inspiration and backup**.

Not a turnkey template; expects local Home Assistant–specific setup and ongoing cleanup. Point it at your own HA instance, entities, and config.

## Prerequisites
Node version manager - [NVM](https://github.com/nvm-sh/nvm) to easily install and manage node versions

## Quick reference

| Task           | Command                          |
|----------------|----------------------------------|
| **Local demo** | `npm run dev`                    |
| **Deploy**     | `npm run build && npm run deploy`|
| **Zip raw code** | `npm run zip` (backup for moving) |

## Reproducing the project (backup workflow)

Commit only what is needed to reproduce the project. Do not commit machine-generated or instance-specific output. On another machine you can:

1. Clone the repo  
2. `npm install`  
3. Copy `.env.example` to `.env` (or `.env.development`) and fill in your values  
4. `npm run sync` (generates `supported-types.d.ts` locally)  
5. `npm run dev`

## Local Development
Run a local dev server with live reload:

```bash
npm run dev
```

Or with NVM and install: `nvm use && npm i && npm run dev`. The dev server watches for changes and reloads the page. 

## Dependencies

```json
Node.js >=20.19.0
npm >=7.0.0
```

## Building
Run `npm run build && npm run deploy` to produce the production build.

## Deploy to Home Assistant via SSH
1. Copy `.env.example` to `.env`, then replace the values with your `VITE_SSH_USERNAME`, `VITE_SSH_HOSTNAME` and `VITE_SSH_PASSWORD`.
2. Build and deploy in one go:

   ```bash
   npm run build && npm run deploy
   ```

   Or run `npm run deploy` on its own after you've already built. Deploy pushes the built files to your Home Assistant instance. SSH setup details are [here](https://shannonhochkins.github.io/ha-component-kit/?path=/docs/introduction-deploying--docs).
3. The `VITE_FOLDER_NAME` is the folder that will be created on your Home Assistant instance; that is where the files are uploaded.

## Folder name & Vite
The `VITE_FOLDER_NAME` is the folder that will be created on your home assistant instance, this is where the files will be uploaded to. If you change the `VITE_FOLDER_NAME` variable, it will also update the `vite.config.ts` value named `base` to the same value so that when deployed using the deployment script the pathname's are correct.

## TypeScript sync

The file `supported-types.d.ts` is **not** in the repo. It is machine-generated and can be regenerated on any machine. Do not commit it.

1. Copy `.env.example` to `.env` (or `.env.development` for local-only secrets), then set `VITE_HA_URL` and `VITE_HA_TOKEN` with your own values.
2. `VITE_HA_URL` should be an HTTPS URL for sync to work.
3. `VITE_HA_TOKEN` instructions are [here](https://shannonhochkins.github.io/ha-component-kit/?path=/docs/introduction-typescriptsync--docs) under the pre-requisites section.

Then run:

```bash
npm run sync
```

This generates `supported-types.d.ts` locally. The project is set up so that any `*.d.ts` in the repo root is included by TypeScript; you do not need to add the file to `tsconfig` by hand.

### HA TOKEN (security)
**Do not put your HA token in `.env`.** Use `.env.development` (gitignored) for local dev only. The app only uses the token when running in dev (`npm run dev`); production builds do not embed it. Never commit `.env` or `.env.development`, and never set `VITE_HA_TOKEN` when building for production.

## Further documentation
For further documentation, please visit the [documentation website](https://shannonhochkins.github.io/ha-component-kit/) for more information.
