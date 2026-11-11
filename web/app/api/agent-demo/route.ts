import {NextResponse}from 'next/server';export function GET(){return NextResponse.json({error:'LEGACY_API_RETIRED'},{status:410})}export const POST=GET;
