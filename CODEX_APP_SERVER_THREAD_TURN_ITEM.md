# Codex App Server: Thread/Turn/Item Payload Reference (v2)

Last updated: 2026-03-08
Schema baseline: codex-cli 0.111.0 (`codex app-server generate-json-schema`)

## Scope

This file lists client-sendable payloads for:
- `thread/*` requests
- `turn/*` requests
- `Item` objects used in `turn/start.input[]` and `turn/steer.input[]`

Method names come from `ClientRequest.json` and field shapes come from `v2/*Params.json`.

## Thread Requests (client -> server)

| Method | Required params | Key optional params |
| --- | --- | --- |
| `thread/start` | none | `approvalPolicy`, `baseInstructions`, `config`, `cwd`, `developerInstructions`, `ephemeral`, `model`, `modelProvider`, `personality`, `sandbox`, `serviceName`, `serviceTier` |
| `thread/resume` | `threadId` | `approvalPolicy`, `baseInstructions`, `config`, `cwd`, `developerInstructions`, `model`, `modelProvider`, `personality`, `sandbox`, `serviceTier` |
| `thread/fork` | `threadId` | `approvalPolicy`, `baseInstructions`, `config`, `cwd`, `developerInstructions`, `model`, `modelProvider`, `sandbox`, `serviceTier` |
| `thread/archive` | `threadId` | none |
| `thread/unarchive` | `threadId` | none |
| `thread/unsubscribe` | `threadId` | none |
| `thread/name/set` | `threadId`, `name` | none |
| `thread/metadata/update` | `threadId` | `gitInfo` (`branch`, `originUrl`, `sha`) |
| `thread/compact/start` | `threadId` | none |
| `thread/rollback` | `threadId`, `numTurns` | none |
| `thread/read` | `threadId` | `includeTurns` |
| `thread/list` | none | `archived`, `cursor`, `cwd`, `limit`, `modelProviders`, `searchTerm`, `sortKey`, `sourceKinds` |
| `thread/loaded/list` | none | `cursor`, `limit` |

### Thread-related enums

- `approvalPolicy`: `untrusted` | `on-failure` | `on-request` | `never` | `{ "reject": { ... } }`
- `sandbox` (thread start/resume/fork): `read-only` | `workspace-write` | `danger-full-access`
- `serviceTier`: `fast` | `flex`
- `personality`: `none` | `friendly` | `pragmatic`

## Turn Requests (client -> server)

| Method | Required params | Key optional params |
| --- | --- | --- |
| `turn/start` | `threadId`, `input` | `approvalPolicy`, `cwd`, `effort`, `model`, `outputSchema`, `personality`, `sandboxPolicy`, `serviceTier`, `summary` |
| `turn/steer` | `threadId`, `expectedTurnId`, `input` | none |
| `turn/interrupt` | `threadId`, `turnId` | none |

### Turn-related enums

- `effort`: `none` | `minimal` | `low` | `medium` | `high` | `xhigh`
- `summary`: `auto` | `concise` | `detailed` | `none`
- `sandboxPolicy.type`: `dangerFullAccess` | `readOnly` | `externalSandbox` | `workspaceWrite`
- `serviceTier`: `fast` | `flex`
- `personality`: `none` | `friendly` | `pragmatic`

## Item (UserInput) Types for `turn/start` and `turn/steer`

`input` is an array of `UserInput` objects.

### 1) `text`

```json
{ "type": "text", "text": "Hello" }
```

Optional: `text_elements` for UI spans.

```json
{
  "type": "text",
  "text": "Open [repo]",
  "text_elements": [
    {
      "byteRange": { "start": 5, "end": 11 },
      "placeholder": "repo"
    }
  ]
}
```

### 2) `image`

```json
{ "type": "image", "url": "https://example.com/image.png" }
```

### 3) `localImage`

```json
{ "type": "localImage", "path": "/abs/path/screenshot.png" }
```

### 4) `skill`

```json
{ "type": "skill", "name": "analyze", "path": "/Users/me/.codex/skills/analyze" }
```

### 5) `mention`

```json
{ "type": "mention", "name": "github", "path": "app://connector_id" }
```

## Minimal request examples

### Start a thread

```json
{
  "id": 1,
  "method": "thread/start",
  "params": {
    "cwd": "/Users/han/Repo/a-team",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request"
  }
}
```

### Start a turn with mixed items

```json
{
  "id": 2,
  "method": "turn/start",
  "params": {
    "threadId": "th_123",
    "input": [
      { "type": "text", "text": "Review this image" },
      { "type": "localImage", "path": "/tmp/a.png" }
    ]
  }
}
```

### Steer active turn

```json
{
  "id": 3,
  "method": "turn/steer",
  "params": {
    "threadId": "th_123",
    "expectedTurnId": "turn_456",
    "input": [{ "type": "text", "text": "Focus on performance regressions" }]
  }
}
```

## Notes

- `turn/start.input[]` and `turn/steer.input[]` share the same `UserInput` schema.
- `thread/rollback` only modifies thread history. It does not revert files in the working directory.
- All fields above are from schema generation output, not inferred.

## References

- https://developers.openai.com/codex/app-server
- https://github.com/openai/codex/tree/main/codex-rs/app-server
