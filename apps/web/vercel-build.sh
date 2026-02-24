#!/bin/bash
# Custom build script for Vercel — runs next build from apps/web context
cd "$(dirname "$0")"
npx next build
