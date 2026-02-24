import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parsePlannerOutput, validatePlannerOutput } from '../src/team/planner-schema';

describe('planner schema validator', () => {
  test('accepts valid planner output', () => {
    const result = parsePlannerOutput({
      plan_summary: 'feature implementation',
      tasks: [
        {
          id: 'team-planner',
          subject: 'Define work',
          role: 'planner',
          maxAttempts: 1,
        },
        {
          id: 'team-executor',
          subject: 'Implement changes',
          role: 'executor',
          depends_on: ['team-planner'],
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.value.planSummary, 'feature implementation');
    assert.equal(result.value.tasks.length, 2);
    assert.equal(result.value.tasks[1].dependencies.length, 1);
  });

  test('accepts camelCase planSummary and dependsOn', () => {
    const result = parsePlannerOutput({
      planSummary: 'feature implementation',
      tasks: [
        {
          id: 'team-planner',
          name: 'Define work',
          role: 'planner',
          maxAttempts: 1,
        },
        {
          id: 'team-executor',
          subject: 'Implement changes',
          role: 'executor',
          dependsOn: ['team-planner'],
          timeoutSeconds: 1800,
        },
      ],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.value.planSummary, 'feature implementation');
    assert.equal(result.value.tasks.length, 2);
    assert.equal(result.value.tasks[1].dependencies.length, 1);
    assert.equal(result.value.tasks[1].timeoutSeconds, 1800);
  });

  test('accepts plain text planner output', () => {
  const result = parsePlannerOutput(`
요약: 사용자 요청 반영 작업

1. [planner] 전체 작업 분해: 팀 태스크 정의; id=team-planner; timeout=1200
2. [researcher] 참고 자료 조사; id=team-researcher; depends=team-planner; maxAttempts=1
3. [developer] 구현 반영; depends=team-researcher; maxAttempts=1; id=team-developer
4. verifier: 결과 검증; depends=team-developer
`);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.source, 'text');
    assert.equal(result.value.planSummary, '사용자 요청 반영 작업');
    assert.equal(result.value.tasks.length, 4);
    assert.equal(result.value.tasks[0].id, 'team-planner');
    assert.equal(result.value.tasks[2].dependencies[0], 'team-researcher');
    assert.equal(result.value.tasks[3].role, 'verifier');
  });

  test('parses JSON payload from plain text planner output', () => {
    const result = parsePlannerOutput(`
Output:
\`\`\`json
{"planSummary":"Feature rollout","tasks":[{"id":"team-planner","subject":"Plan task","role":"planner","depends_on":[],"maxAttempts":2},{"id":"team-verifier","subject":"Verify","role":"verifier","dependsOn":["team-planner"]}]}
\`\`\`
`);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.source, 'json');
    assert.equal(result.value.tasks.length, 2);
    assert.equal(result.value.tasks[1].id, 'team-verifier');
  });

  test('reports missing plan summary', () => {
    const errors = validatePlannerOutput({
      tasks: [{ subject: 'x', role: 'planner' }],
    });
    assert.equal(errors.length > 0, true);
    assert.equal(
      errors.some((item) => item.path === 'plan_summary'),
      true,
    );
  });

  test('invalid role and cycle are detected', () => {
    const result = parsePlannerOutput({
      plan_summary: 'buggy plan',
      tasks: [
        {
          id: 'a',
          role: 'planner',
          description: 'A',
          depends_on: ['b'],
        },
        {
          id: 'b',
          role: 'executor',
          description: 'B',
          depends_on: ['a'],
        },
        {
          id: 'c',
          role: 'wrong',
          description: 'bad role',
        },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.errors.length >= 2, true);
    assert.equal(result.errors.some((item) => item.path === 'tasks[2].role'), true);
    assert.equal(result.errors.some((item) => item.path === 'tasks'), true);
  });
});
