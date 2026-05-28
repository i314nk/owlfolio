import { NextResponse } from 'next/server'

import { initializeSelectedMode } from '../../../../lib/onboarding'

export async function POST(request: Request) {
  const update = await request.json()
  const config = await initializeSelectedMode(update)

  return NextResponse.json({
    config,
    next_destination: '/',
  })
}
