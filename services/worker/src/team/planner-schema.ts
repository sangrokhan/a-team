export type PlannerValidationError = {
  path: string;
  message: string;
};

export type TeamRole = 'planner' | 'researcher' | 'designer' | 'developer' | 'executor' | 'verifier';

export type PlannerTaskTemplate = {
  id: string;
  name: string;
  role: TeamRole;
  dependencies: string[];
  maxAttempts: number;
  timeoutSeconds: number;
};

export type PlannerOutput = {
  planSummary: string;
  tasks: PlannerTaskTemplate[];
};

type PlannerOutputValidation = PlannerOutput;
export type PlannerParseSource = 'json' | 'text';

type PlannerParseBase = {
  source: PlannerParseSource;
  confidence: number;
  raw?: string;
};

export type PlannerParseResult =
  | (PlannerParseBase & {
      ok: true;
      value: PlannerOutput;
    })
  | (PlannerParseBase & {
      ok: false;
      errors: PlannerValidationError[];
      retryable: boolean;
    });

export type PlannerParseFailure = PlannerParseResult & { ok: false };

type UnknownRecord = Record<string, unknown>;

const TEAM_ROLES: TeamRole[] = ['planner', 'researcher', 'designer', 'developer', 'executor', 'verifier'];
const TEAM_ROLE_SET = new Set<string>(TEAM_ROLES);
const SUMMARY_PATTERNS = [
  /^\s*(?:plan\s*summary|summary|요약)\s*[:：-]\s*(.+)\s*$/i,
  /^\s*(?:작업\s*요약|계획)\s*[:：-]\s*(.+)\s*$/i,
];
const TASK_SECTION_PATTERNS = [
  /^\s*(?:tasks?|작업|task\s*list)\s*[:：-]?\s*$/i,
];

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(values: unknown[]): string {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function isTeamRole(value: unknown): value is TeamRole {
  return TEAM_ROLE_SET.has(asString(value).toLowerCase());
}

function collectStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return parseDependencyTokenList(value);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function toPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return asString(value) || fallback;
}

function parseDependencyTokenList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function scanJsonObjects(input: string): string[] {
  const objects: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if ((char === '{' || char === '[') && depth === 0) {
      start = index;
    }

    if (start !== -1 && (char === '{' || char === '[')) {
      depth += 1;
      continue;
    }

    if (start !== -1 && (char === '}' || char === ']')) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function hasPlannerShape(value: unknown): value is PlannerOutput {
  const root = asRecord(value);
  const planSummary = firstString([root.planSummary, root.plan_summary]);
  const rawTasks = Array.isArray(root.tasks) ? root.tasks : [];
  return Boolean(planSummary) && rawTasks.length > 0;
}

function findEmbeddedPlannerOutput(value: unknown, depth = 0): UnknownRecord | null {
  if (depth > 5) {
    return null;
  }

  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.includes('{')) {
      const candidates = scanJsonObjects(value);
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate);
          if (hasPlannerShape(parsed)) {
            return asRecord(parsed);
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEmbeddedPlannerOutput(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const root = asRecord(value);
  if (hasPlannerShape(root)) {
    return root;
  }

  for (const fieldValue of Object.values(root)) {
    const found = findEmbeddedPlannerOutput(fieldValue, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function addError(errors: PlannerValidationError[], path: string, message: string) {
  errors.push({ path, message });
}

export function validatePlannerOutput(value: unknown): PlannerValidationError[] {
  const errors: PlannerValidationError[] = [];
  const root = asRecord(value);
  const planSummary = firstString([root.planSummary, root.plan_summary]);

  if (!planSummary) {
    addError(errors, 'plan_summary', 'plan_summary must be a non-empty string');
  }

  const rawTasks = Array.isArray(root.tasks) ? root.tasks : [];
  if (rawTasks.length === 0) {
    addError(errors, 'tasks', 'tasks must be a non-empty array');
    return errors;
  }

  const tasks: PlannerOutputValidation['tasks'] = [];
  const usedIds = new Set<string>();

  for (let index = 0; index < rawTasks.length; index += 1) {
    const rawTask = asRecord(rawTasks[index]);
    const role = isTeamRole(rawTask.role) ? (rawTask.role as TeamRole) : null;
    if (!role) {
      addError(errors, `tasks[${index}].role`, `invalid role: ${String(rawTask.role)}`);
    }

    const subject = asString(rawTask.subject);
    const description = asString(rawTask.description);
    const name = firstString([subject, description, rawTask.name]);
    if (!name) {
      addError(errors, `tasks[${index}].subject`, 'subject or description must be provided');
    }

    const dependencySource = rawTask.depends_on ?? rawTask.dependsOn ?? rawTask.dependencies;
    const dependencies = collectStringList(dependencySource);
    const maxAttemptsRaw = toPositiveInt(rawTask.maxAttempts);
    const timeoutRaw = toPositiveInt(rawTask.timeoutSeconds);

    const maxAttempts = maxAttemptsRaw ?? 1;
    const timeoutSeconds = timeoutRaw ?? 1200;

    const idRaw = asString(rawTask.id);
    const id = idRaw || `${role ?? 'task'}-${index + 1}`;

    if (usedIds.has(id)) {
      addError(errors, `tasks[${index}].id`, `duplicate task id: ${id}`);
    } else {
      usedIds.add(id);
    }

    tasks.push({
      id,
      name: name || `Task ${index + 1}`,
      role: role ?? 'executor',
      dependencies,
      maxAttempts,
      timeoutSeconds,
    });
  }

  const taskById = new Map<string, PlannerOutputValidation['tasks'][number]>();
  for (const task of tasks) {
    taskById.set(task.id, task);
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      if (!taskById.has(dependencyId)) {
        addError(errors, `tasks.${task.id}.dependencies`, `unknown dependency: ${dependencyId}`);
      }
    }
  }

  const state = new Map<string, 'unvisited' | 'visiting' | 'visited'>();

  const hasCycle = (taskId: string): boolean => {
    const current = state.get(taskId);
    if (current === 'visiting') {
      return true;
    }
    if (current === 'visited') {
      return false;
    }

    state.set(taskId, 'visiting');
    const task = taskById.get(taskId);
    for (const dependencyId of task?.dependencies ?? []) {
      if (hasCycle(dependencyId)) {
        return true;
      }
    }

    state.set(taskId, 'visited');
    return false;
  };

  for (const taskId of taskById.keys()) {
    if (hasCycle(taskId)) {
      addError(errors, 'tasks', `dependency cycle detected for task: ${taskId}`);
      break;
    }
  }

  if (tasks.length === 0) {
    addError(errors, 'tasks', 'no valid task was parsed from planner output');
  }

  return errors;
}

function parseDirectiveLine(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  if (!match || match[1] === undefined) {
    return null;
  }
  return match[1].trim().replace(/^[,;]+|[,;]+$/g, '');
}

function parsePlannerTaskFromText(rawLine: string, taskIndex: number): {
  id: string;
  name: string;
  role: TeamRole;
  dependencies: string[];
  maxAttempts: number;
  timeoutSeconds: number;
} | null {
  const cleanLine = rawLine.trim();
  const bulletMatch = cleanLine.match(/^(?:\d+[\.)]|[-*+])\s+(.*)$/);
  const body = bulletMatch ? bulletMatch[1].trim() : cleanLine;
  if (!body) {
    return null;
  }

  let namePart = body;
  let role: TeamRole = 'executor';

  const bracketRole = namePart.match(/^\[(planner|researcher|designer|developer|executor|verifier)\]\s*[:\-]\s*(.+)$/i);
  if (bracketRole) {
    role = TEAM_ROLES.includes(bracketRole[1].toLowerCase() as TeamRole)
      ? (bracketRole[1].toLowerCase() as TeamRole)
      : 'executor';
    namePart = bracketRole[2].trim();
  } else {
    const plainRole = namePart.match(/^(planner|researcher|designer|developer|executor|verifier)\s*[:\-]\s*(.+)$/i);
    if (plainRole) {
      role = TEAM_ROLES.includes(plainRole[1].toLowerCase() as TeamRole)
        ? (plainRole[1].toLowerCase() as TeamRole)
        : 'executor';
      namePart = plainRole[2].trim();
    }
  }

  const id =
    parseDirectiveLine(namePart, /(?:^|[;,])\s*(?:id|task[_-]?id)\s*[:=]\s*([A-Za-z0-9._-]+)/i) ??
    `${role}-${taskIndex}`;

  const dependencies = collectStringList(
    parseDirectiveLine(namePart, /(?:^|[;,])\s*(?:depends?_?(?:on)?|deps?)\s*[:=]\s*([^;,\n]+(?:,[^;,\n]+)*)/i) ?? '',
  );

  const maxAttempts = toPositiveInt(parseDirectiveLine(namePart, /(?:^|[;,])\s*max(?:imum)?\s*attempts?\s*[:=]\s*(\d+)/i)) ?? 1;
  const timeoutSeconds =
    toPositiveInt(parseDirectiveLine(namePart, /(?:^|[;,])\s*(?:timeout(?:Seconds|_seconds|s|secs)?|time[_-]?limit)\s*[:=]\s*(\d+)/i)) ?? 1200;

  const name = parseDirectiveLine(
    namePart,
    /^\s*(.+?)\s*(?:[;|].*)$/,
  ) ?? namePart;

  const sanitizedName = name
    .replace(/\s*\([^)]*(?:id|depends?|max|timeout)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:id|depends?|max|timeout)[^\]]*\]/gi, '')
    .trim();

  return {
    id,
    name: sanitizedName || `Task ${taskIndex + 1}`,
    role,
    dependencies,
    maxAttempts,
    timeoutSeconds,
  };
}

function parsePlannerFromText(input: string): PlannerParseResult {
  const text = input.trim();
  if (!text) {
    return {
      ok: false,
      source: 'text',
      confidence: 0,
      errors: [{ path: 'planner_output', message: 'planner output is empty' }],
      retryable: true,
      raw: text,
    };
  }

  for (const candidate of scanJsonObjects(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const errors = validatePlannerOutput(parsed);
      if (errors.length === 0) {
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        return {
          ok: true,
          source: 'json',
          confidence: 0.95,
          raw: candidate,
          value: {
            planSummary: firstString([asString(parsed.planSummary), asString(parsed.plan_summary)]),
            tasks: tasks.map((task: UnknownRecord, index: number) => {
              const name = firstString([
                asString(task.subject),
                asString(task.description),
                asString(task.name),
                `Task ${index + 1}`,
              ]);
              const dependencies = collectStringList(task.depends_on ?? task.dependsOn ?? task.dependencies);
              return {
                id: asString(task.id) || `${toStringOrDefault(task.role, `task-${index + 1}`)}-${index + 1}`,
                name,
                role: isTeamRole(task.role) ? (task.role as TeamRole) : ('executor' as TeamRole),
                dependencies,
                maxAttempts: toPositiveInt(task.maxAttempts) ?? 1,
                timeoutSeconds: toPositiveInt(task.timeoutSeconds) ?? 1200,
              };
            }),
          },
        };
      }
    } catch {
      continue;
    }
  }

  const lines = text.split('\n');
  let summary = '';
  let inTaskSection = false;
  const taskLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (!summary) {
      for (const summaryPattern of SUMMARY_PATTERNS) {
        const match = line.match(summaryPattern);
        if (match && match[1]) {
          summary = match[1].trim();
          break;
        }
      }
      if (summary) {
        continue;
      }
    }

    if (!inTaskSection) {
      inTaskSection = TASK_SECTION_PATTERNS.some((pattern) => pattern.test(line));
      if (inTaskSection) {
        continue;
      }
    }

    const looksLikeTaskLine =
      /^(\d+[\.)]|[-*+])\s+/.test(line) ||
      /^(planner|researcher|designer|developer|executor|verifier)\s*[:\-]/i.test(line) ||
      /^\[(planner|researcher|designer|developer|executor|verifier)\]\s*[:\-]/i.test(line);
    if (inTaskSection || looksLikeTaskLine) {
      taskLines.push(line);
    }
  }

  const normalizedTasks: PlannerOutputValidation['tasks'] = [];
  for (let index = 0; index < taskLines.length; index += 1) {
    const parsedTask = parsePlannerTaskFromText(taskLines[index], index + 1);
    if (!parsedTask) {
      continue;
    }

    normalizedTasks.push({
      id: parsedTask.id,
      name: parsedTask.name,
      role: parsedTask.role,
      dependencies: parsedTask.dependencies,
      maxAttempts: parsedTask.maxAttempts,
      timeoutSeconds: parsedTask.timeoutSeconds,
    });
  }

  const planSummary = summary || taskLines[0] || 'Team run plan';
  const normalizedOutput: UnknownRecord = {
    planSummary,
    tasks: normalizedTasks,
  };
  const errors = validatePlannerOutput(normalizedOutput);
  if (errors.length > 0) {
    return {
      ok: false,
      source: 'text',
      confidence: 0.5,
      raw: text,
      errors,
      retryable: true,
    };
  }

  return {
    ok: true,
    source: 'text',
    confidence: 0.72,
    raw: text,
    value: {
      planSummary,
      tasks: normalizedTasks,
    },
  };
}

export function parsePlannerOutput(value: unknown): PlannerParseResult {
  const candidates = Array.isArray(value) ? value : [value];
  const failures: PlannerParseResult[] = [];

  for (const candidate of candidates) {
    const raw = candidate as unknown;

    if (typeof raw === 'string') {
      const result = parsePlannerFromText(raw);
      if (result.ok) {
        return result;
      }
      failures.push(result);
      continue;
    }

    const root = asRecord(raw);
    const embedded = findEmbeddedPlannerOutput(root) ?? root;
    const errors = validatePlannerOutput(embedded);
    if (errors.length === 0) {
      const rawTasks = Array.isArray(embedded.tasks) ? (embedded.tasks as Array<UnknownRecord>) : [];
      const normalizedTasks = rawTasks.map((rawTask, index) => {
        const dependencies = collectStringList(rawTask.depends_on ?? rawTask.dependsOn ?? rawTask.dependencies);
        const id = asString(rawTask.id) || `${toStringOrDefault(rawTask.role, `task-${index + 1}`)}-${index + 1}`;
        const name = firstString([asString(rawTask.subject), asString(rawTask.description), asString(rawTask.name)]);
        const role = isTeamRole(rawTask.role) ? (rawTask.role as TeamRole) : 'executor';
        return {
          id,
          name: name || `Task ${index + 1}`,
          role,
          dependencies,
          maxAttempts: toPositiveInt(rawTask.maxAttempts) ?? 1,
          timeoutSeconds: toPositiveInt(rawTask.timeoutSeconds) ?? 1200,
        };
      });

      return {
        ok: true,
        source: 'json',
        confidence: 1,
        raw: JSON.stringify(embedded),
        value: {
          planSummary: firstString([asString(embedded.planSummary), asString(embedded.plan_summary)]),
          tasks: normalizedTasks,
        },
      };
    }

    failures.push({
      ok: false,
      source: 'json',
      confidence: 0.35,
      raw: JSON.stringify(embedded),
      errors,
      retryable: true,
    });
  }

  if (failures.length === 0) {
    return {
      ok: false,
      source: 'text',
      confidence: 0,
      errors: [{ path: 'planner_output', message: 'unable to parse planner output as JSON or text' }],
      retryable: true,
      raw: asString(value),
    };
  }

  return failures.find((failure) => failure.source === 'text') ?? failures[0];
}
