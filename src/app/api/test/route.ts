import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    message: 'Test API works!',
    timestamp: new Date().toISOString(),
    success: true
  });
}

export async function POST() {
  return NextResponse.json({
    message: 'Test POST API works!',
    timestamp: new Date().toISOString(),
    success: true
  });
}

