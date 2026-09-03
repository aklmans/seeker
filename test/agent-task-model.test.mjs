import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_PLAN_STEPS,
  canTransition,
  normAgentTask,
  recoverRunStatus,
  recoverStepStatus,
  transitionStatus,
  validateTaskPlan,
  validateTaskSpec,
} from '../web/platform/agent/task-model.js';

const scope = {
  collections: ['jobs', 'resumes'],
  tools: ['load_records', 'reason_match', 'write_artifact', 'verify_artifact'],
  effects: ['read_only', 'local_create'],
  maxSteps: 8,
  maxAttempts: 2,
};

function validTask() {
  return {
    id: 'task_1', projectId: 'project_1', workflowId: 'job_application_package',
    title: '岗位投递包', goal: '选择最匹配岗位并生成投递包',
    inputs: { jobIds: ['job_1'], resumeId: 'resume_1' },
    constraints: ['不得虚构经历'],
    deliverables: [{ kind: 'resume_docx' }],
    successCriteria: [{ kind: 'artifacts_verified' }],
    capabilityScope: scope,
    createdBy: 'user', status: 'draft', createdAt: 10, updatedAt: 10,
  };
}

function validPlan() {
  return {
    version: 1,
    summary: '读取、分析、写入并验证',
    steps: [
      { id: 'read', title: '读取输入', kind: 'read', effect: 'read_only', tool: 'load_records', inputs: {}, expectedOutput: '岗位和简历', verification: { kind: 'result' } },
      { id: 'choose', title: '选择岗位', kind: 'reason', effect: 'read_only', inputs: {}, expectedOutput: '选择结果', verification: { kind: 'schema' } },
      { id: 'write', title: '写入产物', kind: 'write', effect: 'local_create', tool: 'write_artifact', inputs: {}, expectedOutput: '文件', verification: { kind: 'file' } },
    ],
  };
}

test('任务归一化只缩权：管理集合、未知 effect 和超预算不能混入 scope', () => {
  const n = normAgentTask({
    ...validTask(),
    status: 'invented',
    capabilityScope: {
      collections: ['jobs', 'profile', 'platform_schedules', 'resumes', 'jobs'],
      tools: ['load_records', 'load_records', ''],
      effects: ['read_only', 'root', 'external_commit'],
      maxSteps: 999,
      maxAttempts: 99,
    },
  });
  assert.deepEqual(n.capabilityScope.collections, ['jobs', 'resumes']);
  assert.deepEqual(n.capabilityScope.tools, ['load_records']);
  assert.deepEqual(n.capabilityScope.effects, ['read_only', 'external_commit']);
  assert.equal(n.capabilityScope.maxSteps, MAX_PLAN_STEPS);
  assert.equal(n.capabilityScope.maxAttempts, 2);
  assert.equal(n.status, 'draft');
});

test('TaskSpec 缺目标、交付物、完成标准或授权时 fail closed', () => {
  assert.equal(validateTaskSpec(validTask()).ok, true);
  const bad = validateTaskSpec({ workflowId: '', title: '', goal: '', deliverables: [], successCriteria: [], capabilityScope: {} });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /workflowId 必填/);
  assert.match(bad.errors.join('\n'), /deliverable/);
  assert.match(bad.errors.join('\n'), /授权工具/);
});

test('状态机只接受显式合法转换，终态不会被模型重新打开', () => {
  assert.equal(canTransition('task', 'draft', 'queued'), true);
  assert.equal(canTransition('run', 'planning', 'running'), true);
  assert.equal(canTransition('step', 'running', 'outcome_unknown'), true);
  assert.equal(canTransition('task', 'succeeded', 'running'), false);
  assert.equal(canTransition('run', 'failed', 'running'), false);
  assert.equal(canTransition('step', 'outcome_unknown', 'running'), false);
  assert.equal(transitionStatus('run', 'created', 'planning'), 'planning');
  assert.throws(() => transitionStatus('run', 'created', 'succeeded'), /非法 run 状态转换/);
});

test('启动恢复不自动继续：运行变 interrupted，未决副作用变 outcome_unknown', () => {
  assert.equal(recoverRunStatus('planning'), 'interrupted');
  assert.equal(recoverRunStatus('running'), 'interrupted');
  assert.equal(recoverRunStatus('waiting_approval'), 'waiting_approval');
  assert.equal(recoverRunStatus('garbage'), 'interrupted');
  assert.equal(recoverStepStatus({ status: 'running', effect: 'read_only' }), 'pending');
  assert.equal(recoverStepStatus({ status: 'running', effect: 'local_create' }), 'outcome_unknown');
  assert.equal(recoverStepStatus({ status: 'running', effect: 'garbage' }), 'outcome_unknown', '未知 effect 往最危险侧恢复');
  assert.equal(recoverStepStatus({ status: 'succeeded', effect: 'local_create' }), 'succeeded');
});

test('合法顺序计划通过并保持纯数据形状', () => {
  const result = validateTaskPlan(validPlan(), scope);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.value.steps.length, 3);
  assert.equal(result.value.steps[1].tool, undefined, '纯推理步骤可以无工具');
});

test('模型计划不能越权工具/effect、重复 id、跳过验证或突破步数上限', () => {
  const raw = validPlan();
  raw.steps[0].tool = 'read_profile';
  raw.steps[1].effect = 'external_commit';
  raw.steps[1].id = 'read';
  raw.steps[2].verification = null;
  const result = validateTaskPlan(raw, scope);
  assert.equal(result.ok, false);
  const errors = result.errors.join('\n');
  assert.match(errors, /tool 未授权/);
  assert.match(errors, /effect 未授权/);
  assert.match(errors, /id 重复/);
  assert.match(errors, /verification 必须为对象/);

  const tooMany = validPlan();
  tooMany.steps = Array.from({ length: 9 }, (_, i) => ({ ...validPlan().steps[0], id: `s${i}` }));
  assert.match(validateTaskPlan(tooMany, scope).errors.join('\n'), /超过上限 8/);
});

test('源守卫：纯模型零 import，隐私/管理集合只以硬拒绝测试数据出现', () => {
  const src = fs.readFileSync(new URL('../web/platform/agent/task-model.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bimport\s/.test(code));
  assert.ok(src.includes("['jobs', 'skills', 'resumes', 'iv_records']"));
  assert.ok(!/TASK_READABLE_COLLECTIONS[^\n]*(profile|platform_)/.test(src));
});
