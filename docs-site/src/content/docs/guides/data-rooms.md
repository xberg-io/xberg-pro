---
title: Data rooms
description: Share an ordered set of project documents with members, invited guests or the public, with optimistic concurrency and per-room limits.
sidebar:
  order: 23
---

**Available in:** Enterprise

Data rooms share an ordered set of a project's documents with members, invited guests or, once published, anyone who holds the public link.

Rooms live in the Enterprise API under `/v1/rooms`. On Pro, every room method fails before it sends a request.

## Enable data rooms

Data rooms are on by default. Set `DATA_ROOMS_ENABLED=false` under `api.env` to switch them off; see [Limits](#limits). To check the state, call `GET /healthz`, which reports `data_rooms.enabled`. When rooms are off, every room route, including the public ones, answers `404` with the code `data_room.disabled`. The SDKs raise this as `DataRoomsDisabledError`, a subclass of their not-found error, so code that already handles `404` still matches.

## Create a room and add documents

```bash
curl -X POST "$XBERG_URL/v1/rooms" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Board pack", "description": "Q3 materials" }'

curl -X POST "$XBERG_URL/v1/rooms/$ROOM_ID/items" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "document_id": "<document uuid>" }'
```

List the project documents a room can hold with `GET /v1/documents`. Items serve three views: `GET /v1/rooms/{id}/items/{document_id}/content` (extracted content), `.../download` (original bytes, when downloads are allowed) and `.../pages/{page_number}` (a page image). `PUT /v1/rooms/{id}/items/order` reorders the items; it must name every item.

`DELETE /v1/rooms/{id}` keeps the room restorable until its `restorable_until`. `GET /v1/rooms?state=deleted` lists those rooms and `POST /v1/rooms/{id}/restore` brings one back. The service permanently removes a room 30 days after a user deletes it.

## Concurrency with `If-Match`

Every room carries an integer version. Three writes send the version you last read in an `If-Match` header. The server refuses a stale version with `412` and a missing one with `428`.

| Write                     | Read the version from                      |
| ------------------------- | ------------------------------------------ |
| Rename or describe a room | `version` on the room                      |
| Reorder items             | `version` on the item list                 |
| Publish or unpublish      | `room_version` on the publication settings |

The version travels in response bodies, not in an `ETag` header. Each versioned write returns the new version. Adding or removing an item also moves the version but returns none, so read the room or its item list again before the next versioned write, or it fails with `412`.

## Members and invitations

Room members hold the role `VIEWER` or `EDITOR`. Ownership moves only by transfer, never by invitation or role change. Manage members at `/v1/rooms/{id}/members` and `/v1/rooms/{id}/members/{user_id}`, move ownership with `/v1/rooms/{id}/ownership`, and leave with `POST /v1/rooms/{id}/leave`. Invite a guest by email:

```bash
curl -X POST "$XBERG_URL/v1/rooms/$ROOM_ID/invitations" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "email": "guest@example.com", "role": "VIEWER" }'
```

An invitation goes only to an address on a domain in `global.authAllowedEmailDomains`, because an invitee on another domain cannot sign in to accept it. The service answers `422` for any other domain, and refuses every invitation when the list is empty. An invitee previews and accepts with their own session token. A project API key gets `403` on those two routes. A token that cannot be accepted answers `404` whatever the reason, and a caller already in the room gets `409`.

## Publish a room

`GET` and `PUT /v1/rooms/{id}/publication` read and set the publication state, with `If-Match` on the write:

```bash
curl -X PUT "$XBERG_URL/v1/rooms/$ROOM_ID/publication" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "If-Match: \"3\"" \
  -H "Content-Type: application/json" \
  -d '{ "state": "published", "mode": "live", "download_allowed": true }'
```

`state` is `published` or `unpublished`, and `mode` is `live` or `reviewed`. A `live` room shows its current items. A `reviewed` room pins a revision, and the `pending_changes` field counts the documents that differ from it. The response carries a `slug`. A published room is readable without credentials under `/public/rooms/{slug}`, with item listing, content and, when allowed, download. A room that does not allow downloads answers `403` on the authenticated route and `404` on the public one. The SDKs strip credential headers from public calls, even on a client built with an API key.

## Limits

Set data room limits under `api.env` in the chart values. Each value is a whole number above zero, and the service refuses to start with any other value.

| Variable                                        | Default | Limit                                                                                                                                                  |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATA_ROOMS_ENABLED`                            | true    | Whether the plan offers data rooms. With `false`, every room route answers `404 data_room.disabled` and `/healthz` reports `data_rooms.enabled: false` |
| `DATA_ROOM_MAX_ROOMS`                           | 100     | Live rooms in one project. A create past the limit answers `409 quota_exceeded`                                                                        |
| `DATA_ROOM_MAX_ITEMS_PER_ROOM`                  | 500     | Items in one room                                                                                                                                      |
| `DATA_ROOM_MAX_MEMBERS_PER_ROOM`                | 100     | People in one room                                                                                                                                     |
| `DATA_ROOM_MAX_PENDING_INVITATIONS`             | 50      | Pending invitations in one room                                                                                                                        |
| `DATA_ROOM_INVITATION_TTL_HOURS`                | 72      | Hours an invitation stays valid                                                                                                                        |
| `DATA_ROOM_PUBLIC_VIEW_REQUESTS_PER_MINUTE`     | 60      | Requests per client address to the public view. A request past the limit answers `429 rate_limited`                                                    |
| `DATA_ROOM_PUBLIC_DOWNLOAD_REQUESTS_PER_MINUTE` | 10      | Requests per client address to a public download                                                                                                       |
| `DATA_ROOM_INVITATION_REQUESTS_PER_MINUTE`      | 30      | Requests per signed-in caller to the invitation routes of one project                                                                                  |

Set `API_TRUSTED_PROXY_CIDRS` and `API_TRUSTED_PROXY_HOPS` under `api.env` when a reverse proxy sits in front of the API. The two public limits then key on the client address in `X-Forwarded-For`; without them, every visitor behind the proxy shares one limit. A row in `data_room_limit_overrides` gives one project its own limits. Its `invitation_requests_per_minute` column replaces the invitation limit for that project, and its `anonymous_requests_per_minute` column adds a second per-address limit on the public view and download. The global public limits stay in force, so that column can lower a project's limit and cannot raise it. A refused request carries `Retry-After`.

## SDKs

All three SDKs wrap these routes with typed errors for `412`, `428` and `data_room.disabled`. See the [data rooms guide](https://docs.sdks.xberg.io/guides/data-rooms/) for the client methods and retry behavior.
