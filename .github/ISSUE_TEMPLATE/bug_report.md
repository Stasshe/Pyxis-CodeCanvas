name: Bug report
description: Report a bug or unexpected behavior in Pyxis CodeCanvas
title: "[Bug] "
labels: [bug]
assignees: []
body:
  - type: markdown
    attributes:
      value: |
        ## 🧩 Pyxis CodeCanvas Bug Report
        Thanks for reporting a bug! Please fill in the details below to help us reproduce and fix the issue efficiently.

  - type: input
    id: summary
    attributes:
      label: 🧠 Summary
      description: A short and clear description of the bug.
      placeholder: e.g. File tree does not refresh after creating a new file.

  - type: textarea
    id: steps
    attributes:
      label: 🔁 Steps to Reproduce
      description: Describe the exact steps to reproduce the issue.
      placeholder: |
        1. Open Pyxis on iPad Safari
        2. Create a new file in a folder
        3. Save it
        4. File does not appear in the tree until reload
      render: bash
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: ✅ Expected Behavior
      description: What should have happened instead?
      placeholder: e.g. The new file should appear immediately in the file tree.

  - type: textarea
    id: actual
    attributes:
      label: ❌ Actual Behavior
      description: What actually happened?
      placeholder: e.g. Nothing happens until manual reload.

  - type: input
    id: version
    attributes:
      label: ⚙️ Pyxis Version / Environment
      description: Include your Pyxis version and browser environment.
      placeholder: e.g. v0.9.3 / iPad Safari 18.0 / iOS 18.1 / Node.js runtime

  - type: dropdown
    id: platform
    attributes:
      label: 💻 Platform
      description: Where are you running Pyxis?
      options:
        - iPad Safari
        - iPad Chrome
        - Desktop Chrome
        - Desktop Edge
        - Other (specify below)
    validations:
      required: true

  - type: dropdown
    id: severity
    attributes:
      label: 🚨 Severity
      description: How severe is the problem?
      options:
        - Minor (no major impact)
        - Moderate (inconvenient but can be worked around)
        - Critical (main feature broken)
    validations:
      required: true

  - type: checkboxes
    id: affected
    attributes:
      label: 🧠 Affected Area
      description: Which part(s) of Pyxis are affected?
      options:
        - label: File system (OPFS / IndexedDB)
        - label: Git / GitHub integration
        - label: Runtime execution (Python / Node.js)
        - label: Transpiler / Compiler (JS, TS)
        - label: UI or rendering
        - label: Localization (i18n)
        - label: Other (describe below)

  - type: textarea
    id: logs
    attributes:
      label: 🧾 Console Logs (optional)
      description: Paste any error messages or stack traces here.
      render: shell

  - type: textarea
    id: additional
    attributes:
      label: 💬 Additional Information
      description: Screenshots, videos, project setup, or anything else that helps reproduce the issue.
      placeholder: e.g. “This happens only when offline” or “GitHub push works, but pull fails.”
