import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isTechContact,
  categorizeContact,
  subcategorizeContact,
} from '@/lib/network-categorizer';

// Parse LinkedIn CSV export format
// Columns: First Name, Last Name, Email Address, Company, Position, Connected On
function parseLinkedInCSV(text: string): Array<{
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  position: string;
  connectedOn: string;
}> {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  // Find header row (LinkedIn CSV has some preamble rows before the actual header)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    if (low.includes('first name') && low.includes('last name')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = parseCSVRow(lines[headerIdx]).map((h) => h.toLowerCase().trim());
  const colIdx = (name: string) => headers.findIndex((h) => h.includes(name));

  const firstNameCol = colIdx('first name');
  const lastNameCol = colIdx('last name');
  const emailCol = colIdx('email');
  const companyCol = colIdx('company');
  const positionCol = colIdx('position');
  const connectedCol = colIdx('connected on');

  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVRow(line);
    const firstName = (firstNameCol >= 0 ? cols[firstNameCol] : '').trim();
    const lastName = (lastNameCol >= 0 ? cols[lastNameCol] : '').trim();

    if (!firstName && !lastName) continue;

    results.push({
      firstName,
      lastName,
      email: (emailCol >= 0 ? cols[emailCol] : '').trim(),
      company: (companyCol >= 0 ? cols[companyCol] : '').trim(),
      position: (positionCol >= 0 ? cols[positionCol] : '').trim(),
      connectedOn: (connectedCol >= 0 ? cols[connectedCol] : '').trim(),
    });
  }

  return results;
}

// Handle quoted CSV fields with commas inside
function parseCSVRow(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const replaceAll = formData.get('replace') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseLinkedInCSV(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Could not parse CSV — check format' }, { status: 400 });
    }

    if (replaceAll) {
      await prisma.contactEntry.deleteMany({});
    }

    let imported = 0;
    let filtered = 0;

    for (const row of rows) {
      const contact = { company: row.company, position: row.position, school: null };

      if (!isTechContact(contact)) {
        filtered++;
        continue;
      }

      const { tier, category } = categorizeContact(contact);
      const subcategory = subcategorizeContact(row.position);

      await prisma.contactEntry.upsert({
        where: {
          firstName_lastName_company: {
            firstName: row.firstName,
            lastName: row.lastName,
            company: row.company,
          },
        },
        update: {
          email: row.email || undefined,
          position: row.position || undefined,
          connectedOn: row.connectedOn || undefined,
          tier,
          category,
          subcategory,
        },
        create: {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email || undefined,
          company: row.company || undefined,
          position: row.position || undefined,
          connectedOn: row.connectedOn || undefined,
          tier,
          category,
          subcategory,
        },
      });

      imported++;
    }

    return NextResponse.json({
      ok: true,
      total: rows.length,
      imported,
      filtered,
    });
  } catch (err) {
    console.error('network/import error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
