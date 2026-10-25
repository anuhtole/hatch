const BASE_URL = process.env.CANVAS_BASE_URL ?? 'https://bcourses.berkeley.edu';
const API_TOKEN = process.env.CANVAS_API_TOKEN ?? '';

async function canvasFetch<T>(
  path: string,
  options: RequestInit = {},
  retries = 3
): Promise<T[]> {
  const url = `${BASE_URL}/api/v1${path}`;
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    let response: Response | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      response = await fetch(nextUrl, {
        ...options,
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (response.status === 403 || response.status === 401) {
        throw new Error(`Canvas auth error: ${response.status}`);
      }

      const remaining = response.headers.get('X-Rate-Limit-Remaining');
      if (remaining !== null && parseFloat(remaining) < 50) {
        await sleep(1000);
      }

      if (response.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        await sleep(wait);
        continue;
      }

      break;
    }

    if (!response || !response.ok) {
      throw new Error(`Canvas API error: ${response?.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      results.push(...data);
    } else if (data && typeof data === 'object') {
      results.push(data);
    }
    // ignore null / empty body

    // Parse Link header for pagination
    const linkHeader: string = response.headers.get('Link') ?? '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }

  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Course = {
  id: number;
  name: string;
  course_code: string;
  enrollment_state: string;
};

export type Assignment = {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  created_at: string | null;
  points_possible: number | null;
  submission: { workflow_state: string } | null;
};

export type CanvasFile = {
  id: number;
  display_name: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  course_id?: number;
};

export type Announcement = {
  id: number;
  title: string;
  message: string;
  posted_at: string;
  context_code: string;
};

export async function getCourses(): Promise<Course[]> {
  const courses = await canvasFetch<Course>(
    '/courses?enrollment_state=active&per_page=50'
  );
  return courses.filter((c) => c.name);
}

export async function getAssignments(courseId: number): Promise<Assignment[]> {
  return canvasFetch<Assignment>(
    `/courses/${courseId}/assignments?include[]=submission&per_page=50`
  );
}

export async function getUpcomingAssignments(
  days = 14,
  bypassCreatedCutoff = false
): Promise<(Assignment & { courseName: string })[]> {
  const courses = await getCourses();
  const dueCutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Prefer ASSIGNMENT_CUTOFF_TIMESTAMP (ISO), fall back to ASSIGNMENT_CUTOFF_DATE (date string)
  const cutoffTimestamp = process.env.ASSIGNMENT_CUTOFF_TIMESTAMP;
  const cutoffDate = process.env.ASSIGNMENT_CUTOFF_DATE;
  const createdCutoff = cutoffTimestamp
    ? new Date(cutoffTimestamp)
    : cutoffDate
    ? new Date(cutoffDate)
    : null;

  const allAssignments = await Promise.all(
    courses.map(async (course) => {
      const assignments = await getAssignments(course.id);
      return assignments.map((a) => ({ ...a, courseName: course.name }));
    })
  );

  return allAssignments
    .flat()
    .filter((a) => {
      if (!a.due_at || new Date(a.due_at) > dueCutoff) return false;
      if (!bypassCreatedCutoff && createdCutoff && a.created_at && new Date(a.created_at) < createdCutoff) return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const dateB = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return dateA - dateB;
    });
}

export async function getCourseFiles(courseId: number): Promise<CanvasFile[]> {
  return canvasFetch<CanvasFile>(
    `/courses/${courseId}/files?per_page=100&sort=updated_at&order=desc`
  );
}

export async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function getAnnouncements(courseId: number): Promise<Announcement[]> {
  return canvasFetch<Announcement>(
    `/courses/${courseId}/discussion_topics?only_announcements=true&per_page=20`
  );
}
