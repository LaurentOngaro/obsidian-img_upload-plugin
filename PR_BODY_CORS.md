Adds a short CORS troubleshooting section explaining that Cloudinary management endpoints may be blocked from browser contexts and suggests manual Console creation or a server-side workaround.

- Adds `src/server/create-preset-example.js` with a small Express server that creates an unsigned upload preset via Cloudinary management API.
- Adds README guidance on how to run the example server and why server-side creation avoids CORS.
- Adds a small unit test `tests/unit/readme.test.ts` to assert the README contains the guidance.

Local validation:
- Ran `npm run ci:checks` locally — all tests passed and build succeeds.
