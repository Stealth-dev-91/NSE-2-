#!/bin/bash
export PATH="$HOME/local/node/bin:$PATH"
cd "$(dirname "$0")"
npx vercel dev --yes
