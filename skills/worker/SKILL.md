---
name: worker
description: Team worker protocol (ACK, mailbox, task lifecycle) for tmux-based A Team teams
---

# Worker Skill

This skill is for a Codex session that was started as an A Team Team worker (a tmux pane spawned by `$team`).

## Identity

You MUST be running with `A_TEAM_TEAM_WORKER` set. It looks like:

`<team-name>/worker-<n>`

Example: `alpha/worker-2`

## Startup Protocol (ACK)

1. Parse `A_TEAM_TEAM_WORKER` into:
   - `teamName` (before the `/`)
   - `workerName` (after the `/`, usually `worker-<n>`)
2. Send an ACK to the lead mailbox:
   - Recipient worker id: `leader-fixed`
   - Body: one short line including your workerName and what you’re ready to do.
3. After ACK, proceed to your inbox instructions.

The lead will see your message in:

`.a-team/state/team/<teamName>/mailbox/leader-fixed.json`

Use the MCP tool:
- `team_send_message` with `{team_name, from_worker, to_worker:"leader-fixed", body}`

## Inbox + Tasks

1. Read your inbox:
   `.a-team/state/team/<teamName>/workers/<workerName>/inbox.md`
2. Pick the first unblocked task assigned to you.
3. Read the task file:
   `.a-team/state/team/<teamName>/tasks/task-<id>.json` (example: `task-1.json`)
4. Task id format:
   - The MCP/state API uses the numeric id (`"1"`), not `"task-1"`.
   - Never use legacy `tasks/{id}.json` wording.
5. Claim the task (do NOT start work without a claim). Use the team state APIs described in your inbox/overlay.
6. Do the work.
7. Write completion to the task file:
   - `{"status":"completed","result":"..."}` or `{"status":"failed","error":"..."}`
8. Update your worker status:
   `.a-team/state/team/<teamName>/workers/<workerName>/status.json` with `{"state":"idle", ...}`

## Mailbox

Check your mailbox for messages:

`.a-team/state/team/<teamName>/mailbox/<workerName>.json`

When notified, read messages and follow any instructions. Use short ACK replies when appropriate.

Use MCP tools:
- `team_mailbox_list` to read
- `team_mailbox_mark_delivered` to acknowledge delivery

## Shutdown

If the lead sends a shutdown request, follow the shutdown inbox instructions exactly, write your shutdown ack file, then exit the Codex session.
