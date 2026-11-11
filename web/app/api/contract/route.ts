import {NextResponse}from 'next/server';export function GET(){return NextResponse.json({error:'LEGACY_API_RETIRED',message:'ACH v4 uses /api/v4.'},{status:410})}
