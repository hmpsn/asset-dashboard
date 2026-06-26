import { describe, expect, it } from 'vitest';

import { expectOmitsAll, readProjectFile } from '../helpers/source-contracts.js';

describe('ContentManager workflow extraction', () => {
  it('keeps post mutation, deep-link, and job workflow in useAdminPostWorkflow', () => {
    const manager = readProjectFile('src/components/ContentManager.tsx');
    const workflow = readProjectFile('src/hooks/admin/useAdminPostWorkflow.ts');

    expect(manager).toContain("from '../hooks/admin/useAdminPostWorkflow'");
    expect(manager).toContain('useAdminPostWorkflow(workspaceId)');
    expect(manager).toContain('beginSendToClient(post.id)');
    expect(manager).toContain('cancelSendToClient');
    expect(manager).toContain('confirmSendToClient(post.id)');

    expectOmitsAll(manager, [
      'contentPosts.',
      'useQueryClient',
      'useBackgroundTasks',
      'useSearchParams',
      'useAdminPostsList',
      'usePublishTarget',
      'useSendPostToClient',
      'setSendToClientPost',
    ]);

    expect(workflow).toContain('export function useAdminPostWorkflow');
    expect(workflow).toContain('contentPosts.publishToWebflow');
    expect(workflow).toContain('contentPosts.update');
    expect(workflow).toContain('contentPosts.remove');
    expect(workflow).toContain('contentPosts.scoreVoice');
    expect(workflow).toContain('useSendPostToClient(workspaceId)');
    expect(workflow).toContain("searchParams.get('post')");
    expect(workflow).toContain('BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE');
  });
});
