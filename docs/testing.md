# Using mocktape in tests

mocktape is a library as well as a CLI. Spin up a real HTTP mock next to your
integration tests — no network stubbing magic, just HTTP your fetch layer
already speaks.

```bash
npm i -D mocktape
```

## Vitest / Jest

```ts
import { createMocktape } from "mocktape";

let tape: Awaited<ReturnType<typeof createMocktape>>;

beforeAll(async () => {
  tape = await createMocktape({
    config: {
      resources: {
        users: { seed: [{ id: 1, name: "Ada" }, { id: 2, name: "Alan" }] },
      },
      routes: [
        {
          name: "payments",
          method: "POST",
          path: "/payments",
          scenarios: {
            default: { status: 201, body: { state: "approved" } },
            declined: { status: 402, body: { error: "card_declined" } },
          },
        },
      ],
    },
  });
});

afterAll(async () => {
  await tape.close();
});

it("lists users", async () => {
  const response = await tape.fetch("/users?_limit=1");
  expect(response.status).toBe(200);
});

it("declines payments on demand", async () => {
  tape.setScenario("payments", "declined");
  const response = await tape.fetch("/payments", { method: "POST" });
  expect(response.status).toBe(402);
  tape.reset(); // back to seeds + default scenarios
});
```

`createMocktape` defaults to: silent logging, dashboard off, random free port,
no file watching — tuned for test environments.

## Replay a cassette inside tests

```ts
const tape = await createMocktape({
  mode: { type: "replay" },
  tape: "cassettes/api.yaml",
});
```

Misses return 404 with the closest match — assert on those to catch contract
drift in CI before your users do.

## Point your app at it

```ts
process.env.API_BASE_URL = tape.url; // before importing your client
```

## Admin API cheatsheet

| Endpoint                     | Method   | Purpose                        |
| ---------------------------- | -------- | ------------------------------ |
| `/__mocktape__/health`       | `GET`    | liveness + mode                |
| `/__mocktape__/routes`       | `GET`    | route table                    |
| `/__mocktape__/scenarios`    | `GET`    | current scenario states        |
| `/__mocktape__/scenarios/:r` | `PUT`    | set state `{"state": "..."}`   |
| `/__mocktape__/reset`        | `POST`   | restore seeds + defaults       |
| `/__mocktape__/resources`    | `GET`    | resource names and row counts  |
| `/__mocktape__/stats`        | `GET`    | request statistics             |
| `/__mocktape__/recent`       | `GET`    | last 50 requests               |
