/**
 * OWASP Top 10 (2021) Mapping Utility
 *
 * Maps CVE findings to OWASP categories and provides associated CWE IDs.
 */

export type OwaspCategory = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A06' | 'A07' | 'A08' | 'A09' | 'A10';

export interface OwaspMapping {
  category: OwaspCategory;
  name: string;
  description: string;
  cweIds: number[];
}

export const OWASP_TOP_10: Record<OwaspCategory, OwaspMapping> = {
  A01: {
    category: 'A01',
    name: 'Broken Access Control',
    description: 'Restrictions on authenticated users are not properly enforced.',
    cweIds: [200, 201, 284, 285, 352, 359, 732, 862, 863, 913],
  },
  A02: {
    category: 'A02',
    name: 'Cryptographic Failures',
    description: 'Failures related to cryptography which often lead to exposure of sensitive data.',
    cweIds: [261, 296, 310, 312, 315, 319, 321, 326, 327, 328, 330, 331, 335, 336, 337, 338, 340, 347, 523, 720, 757, 759, 760, 780, 818, 916],
  },
  A03: {
    category: 'A03',
    name: 'Injection',
    description: 'User-supplied data is not validated, filtered, or sanitized by the application.',
    cweIds: [20, 74, 77, 78, 79, 88, 89, 90, 91, 93, 94, 95, 116, 943],
  },
  A04: {
    category: 'A04',
    name: 'Insecure Design',
    description: 'Missing or ineffective control design.',
    cweIds: [73, 183, 209, 213, 235, 256, 257, 266, 269, 280, 311, 312, 313, 316, 419, 434, 444, 451, 454, 602, 620, 636, 841, 862, 1004, 1173],
  },
  A05: {
    category: 'A05',
    name: 'Security Misconfiguration',
    description: 'Missing appropriate security hardening across any part of the application stack.',
    cweIds: [2, 11, 13, 15, 16, 260, 315, 520, 526, 537, 541, 548, 732],
  },
  A06: {
    category: 'A06',
    name: 'Vulnerable and Outdated Components',
    description: 'Components with known vulnerabilities are used.',
    cweIds: [1035, 1104],
  },
  A07: {
    category: 'A07',
    name: 'Identification and Authentication Failures',
    description: 'Confirmation of user identity, authentication, and session management failures.',
    cweIds: [255, 259, 287, 288, 290, 294, 295, 297, 300, 302, 304, 306, 307, 346, 384, 521, 613, 620, 640, 798, 940, 1216],
  },
  A08: {
    category: 'A08',
    name: 'Software and Data Integrity Failures',
    description: 'Code and infrastructure that does not protect against integrity violations.',
    cweIds: [345, 353, 426, 494, 502, 565, 784, 829, 830, 915],
  },
  A09: {
    category: 'A09',
    name: 'Security Logging and Monitoring Failures',
    description: 'Insufficient logging, detection, monitoring, and active response.',
    cweIds: [117, 223, 532, 778],
  },
  A10: {
    category: 'A10',
    name: 'Server-Side Request Forgery',
    description: 'Web application fetches a remote resource without validating user-supplied URL.',
    cweIds: [918],
  },
};

/** Map a CVE's summary/description to the most likely OWASP category. */
export function mapCveToOwasp(summary: string, packageName: string): OwaspCategory {
  const text = (summary + ' ' + packageName).toLowerCase();
  if (/inject|sql|xss|cross.site|script|command.inject|ldap|xpath/i.test(text)) return 'A03';
  if (/auth|authentication|session|credential|password|token|csrf|bypass/i.test(text)) return 'A07';
  if (/access.control|privilege|permission|authoriz|rbac|idor/i.test(text)) return 'A01';
  if (/crypto|encrypt|tls|ssl|cipher|hash|random|certificate/i.test(text)) return 'A02';
  if (/deserializ|pickle|marshal|prototype.pollution|supply.chain|integrity/i.test(text)) return 'A08';
  if (/ssrf|request.forgery|server.side/i.test(text)) return 'A10';
  if (/config|misconfig|default|expose|disclose|information/i.test(text)) return 'A05';
  if (/log|monitor|audit|trace/i.test(text)) return 'A09';
  return 'A06'; // default: vulnerable component
}
