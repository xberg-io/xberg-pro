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

Every room carries an integer version. Four writes send the version you last read in an `If-Match` header. The server refuses a stale version with `412` and a missing one with `428`.

| Write                         | Read the version from                      |
| ----------------------------- | ------------------------------------------ |
| Rename or describe a room     | `version` on the room                      |
| Reorder items                 | `version` on the item list                 |
| Enable or disable link access | `version` on the link list                 |
| Publish or unpublish          | `room_version` on the publication settings |

The version travels in response bodies, not in an `ETag` header. Each versioned write returns the new version. Adding or removing an item also moves the version but returns none, so read the room or its item list again before the next versioned write, or it fails with `412`.

## Members and invitations

Room members hold the role `VIEWER` or `EDITOR`. Ownership moves only by transfer, never by invitation or role change. Manage members at `/v1/rooms/{id}/members` and `/v1/rooms/{id}/members/{user_id}`, move ownership with `/v1/rooms/{id}/ownership`, and leave with `POST /v1/rooms/{id}/leave`. Invite a guest by email:

```bash
curl -X POST "$XBERG_URL/v1/rooms/$ROOM_ID/invitations" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "email": "guest@example.com", "role": "VIEWER" }'
```

An invitation goes only to an address on a domain in `global.authAllowedEmailDomains`, because an invitee on another domain cannot sign in to accept it. The service answers `422` for any other domain, and refuses every invitation when the list is empty. An invitee signs in with the invited address and accepts with their own session token. The address comparison is case-insensitive. A project API key gets `403` on those two routes. A token that cannot be accepted answers `404` whatever the reason, and a caller already in the room gets `409`. An invitation preview shows the room name, the document count and the inviter's display name, and no document content.

## Permissions

A room is a selection of finished documents from one project. Access to a room does not grant access to the project's other documents, and project document routes keep their own authorization. Every request for a room document passes the room's authorization check.

| Action                                            | Owner | Editor | Viewer |
| ------------------------------------------------- | ----- | ------ | ------ |
| View room metadata and items                      | Yes   | Yes    | Yes    |
| Edit the room name or description                 | Yes   | Yes    | No     |
| Add, remove or reorder items                      | Yes   | Yes    | No     |
| Manage members, invitations and sharing links     | Yes   | No     | No     |
| Delete or restore the room                        | Yes   | No     | No     |
| Transfer ownership or read the room audit history | Yes   | No     | No     |

These are the default room roles. A custom project role uses its effective permissions, and the room response reports the caller's current rights.

- A caller with the project permission `data_room.manage` holds every room right across the project.
- Publishing needs permission to read the room and the project permission `data_room.publish`. A room role alone grants neither publication nor project document access.
- Adding a document needs room item-write access and the project permission `document.read`. The document must have a finished version in the same project.
- Ownership transfers to a project member who already holds a room grant.
- A role-bound API key cannot change membership, transfer ownership or change publication.

Removing a person's grant ends their later access. Removing someone from the project also removes the room grants attached to that membership. If the room owner leaves the project, ownership of the room passes to an eligible project owner, including for a room still inside its restore window.

## Sharing links

Sharing links let a signed-in user join a room without a named invitation. Link access starts disabled on a new room.

```bash
curl -X PUT "$XBERG_URL/v1/rooms/$ROOM_ID/links" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "If-Match: \"4\"" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": true }'

curl -X POST "$XBERG_URL/v1/rooms/$ROOM_ID/links" \
  -H "Authorization: Bearer $XBERG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "role": "VIEWER", "expires_at": "2027-01-31T00:00:00Z" }'
```

Enable link access with the room version from `GET /v1/rooms/{id}/links`. Create a link with the role `VIEWER` or `EDITOR` and an optional `expires_at`. The token appears only in the create response, and the service stores a hash, so a lost token needs a new link. A recipient signs in with an eligible account and takes the link up at `POST /v1/room-links/accept`. A token that cannot be used answers `404`, including when link access is disabled.

`DELETE /v1/rooms/{id}/links/{link_id}` revokes one link and ends the grants it issued. Disabling link access revokes every existing token and the grants taken through them, and enabling it later needs new tokens. Named grants and public publication keep their own settings. A room holds as many active links as it may hold pending invitations.

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

### Publication modes

- **Live** follows the room: items you add or remove appear in the public view.
- **Reviewed** holds the published revision. Changes to the room stay pending until a publisher publishes them, and removing an item from the draft takes it out of the public view only on that republish. Switching a reviewed room to live while changes are pending also publishes them.
- **Unpublished** hides the public view and keeps its address, so publishing again reuses the same slug.

Public responses expose the published view with opaque item references and no internal project identifiers. The item list carries the file name, MIME type, size and update time. Public routes send `X-Robots-Tag: noindex`. A request for an unpublished or unknown room gets the same refusal. Setting `download_allowed` decides whether the public API serves the original files.

A deleted room can be restored within 30 days when the project has quota. Restoring makes a room that is still published reachable at its original public address again.

## Caching and revocation

Authenticated `/v1/rooms` responses send `Cache-Control: private, no-store`, including room metadata, content, page images, downloads and authorization refusals. Each request needs current room access.

Successful anonymous responses, original-file downloads included, send `Cache-Control: public, max-age=60, must-revalidate`. After 60 seconds a cache must revalidate with the service, which refuses withdrawn rooms and items removed from publication and sends `no-store` on those refusals. Unpublishing or removing an item therefore stops public access within about a minute at any standards-compliant cache.

The room API serves original bytes directly when the caller's audience and the download setting allow it, and issues no signed storage URL. Copies a recipient already downloaded are outside revocation.

Revoking a link, removing a member or disabling link access ends the access it granted on the next request. On upgrade, a room that already has a live link or an active link-derived grant keeps its access unless a manager has configured the room, so existing shares keep working.

## Limits

Set data room limits under `api.env` in the chart values. Each value is a whole number above zero, and the service refuses to start with any other value.

| Variable                                        | Default | Limit                                                                                                                                   |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_ROOMS_ENABLED`                            | true    | Turns data rooms on. With `false`, every room route answers `404 data_room.disabled` and `/healthz` reports `data_rooms.enabled: false` |
| `DATA_ROOM_MAX_ROOMS`                           | 100     | Live rooms in one project. A create past the limit answers `409 quota_exceeded`                                                         |
| `DATA_ROOM_MAX_ITEMS_PER_ROOM`                  | 500     | Items in one room                                                                                                                       |
| `DATA_ROOM_MAX_MEMBERS_PER_ROOM`                | 100     | People in one room                                                                                                                      |
| `DATA_ROOM_MAX_PENDING_INVITATIONS`             | 50      | Pending invitations in one room                                                                                                         |
| `DATA_ROOM_INVITATION_TTL_HOURS`                | 72      | Hours an invitation stays valid                                                                                                         |
| `DATA_ROOM_PUBLIC_VIEW_REQUESTS_PER_MINUTE`     | 60      | Requests per client address to the public view. A request past the limit answers `429 rate_limited`                                     |
| `DATA_ROOM_PUBLIC_DOWNLOAD_REQUESTS_PER_MINUTE` | 10      | Requests per client address to a public download                                                                                        |
| `DATA_ROOM_INVITATION_REQUESTS_PER_MINUTE`      | 30      | Requests per signed-in caller to the invitation routes of one project                                                                   |

Set `API_TRUSTED_PROXY_CIDRS` and `API_TRUSTED_PROXY_HOPS` under `api.env` when a reverse proxy sits in front of the API. The two public limits then key on the client address in `X-Forwarded-For`; without them, every visitor behind the proxy shares one limit. Per-project limit overrides are available through [support](/more/support/). A refused request carries `Retry-After`.

## SDKs

All three SDKs wrap these routes with typed errors for `412`, `428` and `data_room.disabled`. See the [data rooms guide](https://docs.sdks.xberg.io/guides/data-rooms/) for the client methods and retry behavior.
