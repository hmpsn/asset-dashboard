import { URL } from 'url';
import type {
  ContentReviewClaimEvidence,
  ContentReviewEvidence,
  ContentReviewEvidenceCandidate,
} from '../shared/types/content.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'with',
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

function extractNumericTokens(value: string): string[] {
  return Array.from(new Set((value.match(/\b(?:19|20)\d{2}\b|\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b|\b\d+(?:\.\d+)?%?\b/g) ?? [])));
}

function overlapCount(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  return a.filter(token => bSet.has(token)).length;
}

function inferReferenceLabel(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, '');
  } catch { // catch-ok - malformed reference URL should degrade to raw label text for reviewer support
    return urlString;
  }
}

function buildReferenceCandidates(
  claimTokens: string[],
  numericTokens: string[],
  evidence: ContentReviewEvidence,
): ContentReviewEvidenceCandidate[] {
  const candidates: ContentReviewEvidenceCandidate[] = [];

  for (const result of evidence.topResults) {
    const resultTokens = tokenize(`${result.title} ${result.url}`);
    const overlap = overlapCount(claimTokens, resultTokens);
    const numericOverlap = numericTokens.filter(token => `${result.title} ${result.url}`.includes(token)).length;
    if (
      overlap >= 2
      || (numericTokens.length > 0 && numericOverlap > 0 && overlap >= 1)
    ) {
      candidates.push({
        kind: 'serp_top_result',
        label: result.title,
        url: result.url,
        position: result.position,
        confidence: overlap >= 3 || (overlap >= 2 && numericOverlap > 0) ? 'strong' : 'possible',
        matchReason: numericOverlap > 0
          ? 'Shares the same numeric/statistical signal as the claim.'
          : 'Shares the strongest topic overlap among saved top results.',
      });
    }
  }

  for (const question of evidence.peopleAlsoAsk) {
    const questionTokens = tokenize(question);
    const overlap = overlapCount(claimTokens, questionTokens);
    if (overlap >= 2) {
      candidates.push({
        kind: 'paa',
        label: question,
        confidence: overlap >= 3 ? 'strong' : 'possible',
        matchReason: 'Matches the same question/topic captured from People Also Ask.',
      });
    }
  }

  for (const referenceUrl of evidence.referenceUrls ?? []) {
    const referenceLabel = inferReferenceLabel(referenceUrl);
    const referenceTokens = tokenize(`${referenceLabel} ${referenceUrl}`);
    const overlap = overlapCount(claimTokens, referenceTokens);
    if (overlap >= 1) {
      candidates.push({
        kind: 'reference_url',
        label: referenceLabel,
        url: referenceUrl,
        confidence: overlap >= 2 ? 'strong' : 'possible',
        matchReason: 'The claim overlaps with a saved reference URL/domain from the brief.',
      });
    }
  }

  return candidates.slice(0, 4);
}

export function buildClaimEvidenceLedger(
  claimsToVerify: string[],
  evidence?: ContentReviewEvidence,
): ContentReviewClaimEvidence[] {
  return claimsToVerify.map((claim) => {
    const normalizedClaim = normalizeWhitespace(claim);
    const claimTokens = tokenize(normalizedClaim);
    const numericTokens = extractNumericTokens(normalizedClaim);

    const sourceCandidates = evidence
      ? buildReferenceCandidates(claimTokens, numericTokens, evidence)
      : [];

    return {
      claim: normalizedClaim,
      sourceCandidates: sourceCandidates.length > 0
        ? sourceCandidates
        : [{
            kind: 'manual_unknown',
            label: 'No likely source found in saved evidence',
            confidence: 'possible',
            matchReason: evidence
              ? 'The saved SERP/reference evidence did not clearly overlap with this claim.'
              : 'No saved source pack was available for this post review.',
          }],
    };
  });
}
