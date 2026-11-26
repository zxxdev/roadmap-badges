#!/usr/bin/env bash
# Regenerates the example JUnit reports in this folder with the real tools, so
# the reader is tested against what they actually write, not against files
# written by hand. The reports are committed; CI does not run this script.
#
# Needs: the repository's dependencies (pnpm install), PowerShell 7 with
# Pester 5 or later, and Python 3 with pytest. Some example tests fail on
# purpose, so the tools' exit codes are ignored; the script checks instead
# that each report was written.
#
# The only change made to the reports is removing the absolute path of the
# repository, so they do not depend on where they were generated.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
cd "$here"
rm -f vitest.xml pester.xml pytest.xml

pnpm --dir "$root" exec vitest run --config "$here/vitest/vitest.config.ts" \
  --reporter=junit --outputFile="$here/vitest.xml" > /dev/null || true

pwsh -NoProfile -NonInteractive -Command '
  $config = New-PesterConfiguration
  $config.Run.Path = "pester"
  $config.Output.Verbosity = "None"
  $config.TestResult.Enabled = $true
  $config.TestResult.OutputFormat = "JUnitXml"
  $config.TestResult.OutputPath = "pester.xml"
  Invoke-Pester -Configuration $config
' || true

PYTHONDONTWRITEBYTECODE=1 python3 -m pytest pytest -q -p no:cacheprovider \
  --junitxml=pytest.xml > /dev/null || true

for report in vitest.xml pester.xml pytest.xml; do
  test -s "$report" || { echo "error: $report was not written" >&2; exit 1; }
  sed -i -e "s#$here/##g" -e "s#$root/##g" "$report"
done
echo "Wrote vitest.xml, pester.xml and pytest.xml."
