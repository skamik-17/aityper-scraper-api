#!/bin/bash
echo "Checking for missing STS market ID mappings in sts-normalizer.ts"
echo ""

# Extract market IDs from analysis
cd logs/sts-markets-analysis
IDS=$(grep -ho "MARKET ID [0-9]*" combinations.txt first-half.txt goals.txt handicaps.txt second-half.txt time-based.txt uncategorized.txt 2>/dev/null | cut -d' ' -f3 | sort -n -u)

# Check each ID against sts-normalizer
echo "Market IDs found in analysis:"
for id in $IDS; do
  grep -q "\"$id\":" src/services/normalization/bookmakers/sts-normalizer.ts 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "  $id: MAPPED"
  else
    echo "  $id: NOT MAPPED"
  fi
done
