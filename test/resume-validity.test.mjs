import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasJobContent, hasProfessionalContent } from '../web/apps/jobseek/logic/resume-validity.js';

test('空数组、空字符串和空占位简历都不是有效职业资料', () => {
  for (const resume of [
    {},
    { master: true, work: [], projects: [], edu: [] },
    { work: [{ org: ' ', title: '', date: '2026', bullets: ['  '] }] },
    { projects: [{ name: '', link: 'https://example.test', star: true, bullets: [] }] },
    { edu: [{ org: '\n', title: '\t' }], strengths: '   ', certs: [] },
    { portfolio: 'https://example.com' },
    { summary: '2026-09-03' },
    { skills: ['2026'] },
    { summary: 'Sep 2026' },
    { other: { active: true, website: 'https://example.test' } },
  ]) {
    assert.equal(hasProfessionalContent(resume), false);
  }
});

test('岗位必须同时包含公司、职位，以及 JD 或必备技能', () => {
  for (const job of [
    {},
    { id: 'j1' },
    { co: 'Acme', role: 'Engineer' },
    { co: 'https://example.com', role: 'Engineer', jd: 'Build systems' },
    { co: 'Acme', role: '2026-09-03', need: ['Rust'] },
    { co: 'Acme', role: 'Engineer', jd: 'https://example.com' },
    { co: 'Acme', role: 'Engineer', need: ['2026'] },
  ]) assert.equal(hasJobContent(job), false);

  for (const job of [
    { co: 'Acme', role: 'Engineer', jd: 'Build reliable systems' },
    { co: 'Acme', role: 'Engineer', need: ['Rust'] },
    { company: 'Acme', title: 'Engineer', requiredSkills: ['Rust'] },
  ]) assert.equal(hasJobContent(job), true);
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
