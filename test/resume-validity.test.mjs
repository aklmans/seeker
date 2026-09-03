import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasProfessionalContent } from '../web/apps/jobseek/logic/resume-validity.js';

test('空数组、空字符串和空占位简历都不是有效职业资料', () => {
  for (const resume of [
    {},
    { master: true, work: [], projects: [], edu: [] },
    { work: [{ org: ' ', title: '', date: '2026', bullets: ['  '] }] },
    { projects: [{ name: '', link: 'https://example.test', star: true, bullets: [] }] },
    { edu: [{ org: '\n', title: '\t' }], strengths: '   ', certs: [] },
  ]) {
    assert.equal(hasProfessionalContent(resume), false);
  }
});

test('真实经历或约定的实质字段可以作为 Agent 输入', () => {
  for (const resume of [
    { work: [{ org: 'Acme' }] },
    { projects: [{ bullets: ['Built a queue'] }] },
    { edu: [{ degree: 'BSc Computer Science' }] },
    { strengths: 'Distributed systems' },
    { skills: ['Rust'] },
  ]) {
    assert.equal(hasProfessionalContent(resume), true);
  }
});
