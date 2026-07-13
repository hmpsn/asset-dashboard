// tests/fixtures/content-seed.ts
// Shared content pipeline fixture for integration tests.
// Creates a workspace + content topic request + brief + post for content workflow testing.

import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

export interface SeededContent {
  workspaceId: string;
  requestId: string;
  briefId: string;
  postId: string;
  cleanup: () => void;
}

/**
 * Creates a workspace with a content topic request, content brief, and content post.
 * All linked together via IDs to simulate a complete content pipeline flow.
 */
export function seedContentData(): SeededContent {
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `test-content-${suffix}`;
  const requestId = `req-${suffix}`;
  const briefId = `brief-${suffix}`;
  const postId = `post-${suffix}`;
  const now = new Date().toISOString();
  const targetKeyword = `test keyword ${suffix}`;

  // Insert workspace
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, tier, created_at)
    VALUES (?, ?, ?, 'free', ?)
  `).run(workspaceId, `Content Test ${suffix}`, `content-test-${suffix}`, now);

  // Insert content topic request
  db.prepare(`
    INSERT INTO content_topic_requests
      (id, workspace_id, topic, target_keyword, intent, priority, rationale,
       status, brief_id, source, service_type, page_type, comments, requested_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
  `).run(
    requestId,
    workspaceId,
    `Test Topic ${suffix}`,
    targetKeyword,
    'informational',
    'medium',
    'Test rationale for content request',
    'approved',
    briefId,
    'strategy',
    'brief_only',
    'blog',
    now,
    now,
  );

  // Insert content brief
  db.prepare(`
    INSERT INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    briefId,
    workspaceId,
    targetKeyword,
    JSON.stringify([`${targetKeyword} guide`]),
    `How to ${targetKeyword}`,
    `Learn everything about ${targetKeyword} in this comprehensive guide.`,
    JSON.stringify([{
      heading: `How ${targetKeyword} works`,
      notes: 'Explain the core concept with practical guidance.',
      wordCount: 600,
    }]),
    1500,
    'informational',
    'general audience',
    'Top-ranking guides explain the topic clearly and support advice with practical examples.',
    JSON.stringify(['/services']),
    now,
  );

  // Insert content post
  db.prepare(`
    INSERT INTO content_posts
      (id, workspace_id, brief_id, target_keyword, title, meta_description,
       introduction, sections, conclusion, total_word_count, target_word_count,
       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    postId,
    workspaceId,
    briefId,
    targetKeyword,
    `How to ${targetKeyword}`,
    `Learn everything about ${targetKeyword}.`,
    `<p>This guide explains ${targetKeyword} in depth and shows readers how to apply it.</p>`,
    JSON.stringify([{
      index: 0,
      heading: `How ${targetKeyword} works`,
      content: `<p>Start with a clear goal, follow a practical process, and measure the results for ${targetKeyword}.</p>`,
      wordCount: 15,
      targetWordCount: 600,
      keywords: [targetKeyword],
      status: 'done',
    }]),
    `<p>Use these steps to make ${targetKeyword} a repeatable part of the broader strategy.</p>`,
    1200,
    1500,
    now,
    now,
  );

  const cleanup = () => {
    db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  };

  return { workspaceId, requestId, briefId, postId, cleanup };
}
