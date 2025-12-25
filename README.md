## GitHub Classroom Command Grader

### Overview
**GitHub Classroom Command Grader** is a plugin for GitHub Classroom's Autograder. Seamlessly integrate your CS class with GitHub using this action to facilitate the grading process.

### Key Features
- **Automatic Grading**: Evaluate student code submissions and provide immediate feedback.
- **Customizable Test Setup**: Define pre-test setup commands and specific testing commands.
- **Command Execution**: Run any command and determine the success based on the exit code.
- **Timeout Control**: Limit the runtime of tests to prevent excessive resource usage, with a maximum duration of 6 hours.
- **Scoring System**: Assign a maximum score for tests, awarding points upon successful test completion.

### Inputs

| Input Name      | Description                                                                                                     | Required |
|-----------------|-----------------------------------------------------------------------------------------------------------------|----------|
| `test-name`     | The unique identifier for the test.                                                                             | Yes      |
| `setup-command` | Command to execute prior to the test, typically for environment setup or dependency installation.               | No       |
| `command`       | Primary command to run for the test. A zero exit code signifies a successful test.                              | Yes      |
| `timeout`       | Duration (in minutes) before the test is terminated. Defaults to 10 minutes with a maximum limit of 6 hours.    | No       |
| `max-score`     | Points to be awarded if the test passes.                                                                        | No       |

### Outputs

| Output Name | Description                        |
|-------------|------------------------------------|
| `result`    | Outputs the result of the grader, indicating the success or failure of the test.  |

### Usage

1. Add the GitHub Classroom Command Grader action to your workflow.

```
name: Autograding Tests
on:
  - workflow_dispatch
  - repository_dispatch
permissions:
  checks: write
  actions: read
  contents: read
jobs:
  run-autograding-tests:
    runs-on: ubuntu-latest
    if: github.actor != 'github-classroom[bot]'
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Run tests.
        id: run-tests
        uses: baraksu-class-2026/autograding-command-grader@v1
        with:
          test-name: Run tests.
          setup-command: mvn clean
          command: mvn test
          timeout: 10
          max-score: 100
      - name: Autograding Reporter
        uses: classroom-resources/autograding-grading-reporter@v1
        env:
          RUN-TESTS_RESULTS: "${{steps.run-tests.outputs.result}}"
        with:
          runners: run-tests
```
