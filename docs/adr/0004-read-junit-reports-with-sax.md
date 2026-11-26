# 0004. Read JUnit reports with sax in strict mode

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The action reads JUnit XML reports written by other tools, in workflows it does not control. A
report is untrusted input, and XML has two classic attacks: entities that expand to gigabytes
from a few lines ("billion laughs"), and external entities that read a file from the machine
(XXE). The parser must refuse both and say which file it could not read.

It also goes into the bundle that every user runs, so each dependency it brings is code that
runs in other people's workflows. "JUnit XML" has no single standard, so the parser only needs
elements, attributes and positions; the reader absorbs the differences between tools.

Three parsers were checked on 2026-11-26, each older than the 7-day quarantine, by running the
same malicious files through them in the development VM:

## Options

1. **fast-xml-parser 5.12.** The most common choice. It now depends on six packages. By default
   it does not decode character references such as `&#233;`, and it returns data for broken XML
   unless the document is validated in a separate call. Safe with the right options, but more
   options to get right and more code in the bundle.
2. **@xmldom/xmldom 0.9.** A DOM parser with no dependencies; it does not expand DTD entities.
   It reports an undefined entity as a non-fatal error and carries on, so the reader would have
   to collect errors itself to be sure nothing was skipped.
3. **sax 1.6 in strict mode.** No dependencies, maintained by the author of npm, and widely
   used. It never expands entities declared in a DOCTYPE and never loads external
   ones: an entity that is not one of XML's five built-in ones is an error, with line and
   column. It decodes `&amp;` and character references, and reads the file as a stream of events.

## Decision

Option 3: sax in strict mode, with a reader that walks the events and keeps only what it needs.

## Consequences

- The billion laughs and XXE files are refused at once with a clear message; tests check both,
  and that the refusal takes well under a second.
- One small dependency with none of its own. Its licence (Blue Oak 1.0.0) asks that copies keep
  its text, which `dist/licenses.txt` now does for every bundled package.
- The reader handles events itself (open and close tags), which is a little more code than
  asking a DOM for every `testcase`; the tests cover nesting, roots and child elements.
- A report that really needs DOCTYPE entities would be refused. No common test tool writes one.
- sax's types come from `@types/sax`, a development dependency that does not go into the bundle.
