# 01 — CRUD from a single file

```bash
mocktape dev examples/01-crud/mocktape.json
# dashboard: http://localhost:3001
```

You now have a full REST API with an in-memory database:

```bash
curl http://localhost:3000/users                 # list
curl "http://localhost:3000/users?role=admin"    # filter
curl "http://localhost:3000/users?_sort=id&_order=desc"
curl "http://localhost:3000/users?_page=1&_limit=2"
curl "http://localhost:3000/users/1"             # one
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"New User"}'                       # auto id
curl -X PATCH http://localhost:3000/users/1 \
  -H 'content-type: application/json' \
  -d '{"role":"user"}'
curl -X DELETE http://localhost:3000/users/1
```

Nested resources work too: `GET /users/1/posts` filters `posts` by `userId`.

Add `"persist": "db.json"` to a resource and mutations survive restarts.
