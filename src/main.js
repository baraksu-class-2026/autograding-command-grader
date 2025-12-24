const core = require('@actions/core')
const {execSync} = require('child_process')
const fs = require('fs')
const path = require('path')
const {parseStringPromise} = require('xml2js')

const env = {
  PATH: process.env.PATH,
  FORCE_COLOR: 'true',
  DOTNET_CLI_HOME: '/tmp',
  DOTNET_NOLOGO: 'true',
  HOME: process.env.HOME,
}

function btoa(str) {
  return Buffer.from(str).toString('base64')
}

function generateResult(status, testName, command, message, duration, maxScore) {
  return {
    version: 1,
    status,
    max_score: maxScore,
    tests: [
      {
        name: testName,
        status,
        score: status === 'pass' ? maxScore : 0,
        message,
        test_code: command,
        filename: '',
        line_no: 0,
        duration,
      },
    ],
  }
}

async function parseXmlReports(reportsDir, command, maxScore) {
  const testResults = []
  
  if (!fs.existsSync(reportsDir)) {
    return testResults
  }

  const xmlFiles = fs.readdirSync(reportsDir).filter(file => file.endsWith('.xml'))
  
  for (const xmlFile of xmlFiles) {
    const xmlPath = path.join(reportsDir, xmlFile)
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8')
    
    try {
      const result = await parseStringPromise(xmlContent)
      const testsuite = result.testsuite?.$
      
      if (testsuite) {
        const tests = parseInt(testsuite.tests || 0)
        const errors = parseInt(testsuite.errors || 0)
        const skipped = parseInt(testsuite.skipped || 0)
        const failures = parseInt(testsuite.failures || 0)
        const time = parseFloat(testsuite.time || 0)
        
        const totalEligible = tests - skipped
        const passed = tests - skipped - failures - errors
        const score = totalEligible > 0 ? (passed / totalEligible) * maxScore : 0
        const status = (failures === 0 && errors === 0) ? 'pass' : 'fail'
        
        testResults.push({
          name: xmlFile,
          status,
          score,
          message: `Tests: ${tests}, Passed: ${passed}, Failures: ${failures}, Errors: ${errors}, Skipped: ${skipped}`,
          test_code: command,
          xmlFile: '',
          line_no: 0,
          duration: time * 1000, // Convert to milliseconds
        })
      }
    } catch (error) {
      console.error(`Error parsing ${xmlFile}: ${error.message}`)
    }
  }
  
  return testResults
}

function getErrorMessageAndStatus(error, command) {
  if (error.message.includes('ETIMEDOUT')) {
    return { status: 'error', errorMessage: 'Command timed out' }
  }
  if (error.message.includes('command not found')) {
    return { status: 'error', errorMessage: `Unable to locate executable file: ${command}` }
  }
  if (error.message.includes('Command failed')) {
    return { status: 'fail', errorMessage: 'failed with exit code 1' }
  }
  return  { status: 'error', errorMessage: error.message }
}

async function run() {
  const testName = core.getInput('test-name', {required: true})
  const setupCommand = core.getInput('setup-command')
  const command = core.getInput('command', {required: true})
  const timeout = parseFloat(core.getInput('timeout') || 10) * 60000 // Convert to minutes
  const maxScore = parseInt(core.getInput('max-score') || 0)

  let output = ''
  let startTime
  let endTime
  let result

  try {
    if (setupCommand) {
      execSync(setupCommand, {timeout, env, stdio: 'inherit'})
    }

    startTime = new Date()
    output = execSync(command, {timeout, env, stdio: 'inherit'})?.toString()
    endTime = new Date()

    // Check for XML test reports
    const reportsDir = path.join(process.cwd(), 'target', 'surefire-reports')
    const xmlTests = await parseXmlReports(reportsDir, command, maxScore)
    
    if (xmlTests.length > 0) {
      // Use XML test results
      const overallStatus = xmlTests.every(t => t.status === 'pass') ? 'pass' : 'fail'
      
      result = {
        version: 1,
        status: overallStatus,
        max_score: maxScore,
        tests: xmlTests,
      }
    } else {
      // Fallback to original behavior
      result = generateResult('pass', testName, command, output, endTime - startTime, maxScore)
    }
  } catch (error) {
    endTime = new Date()
    const {status, errorMessage} = getErrorMessageAndStatus(error, command)
    result = generateResult(status, testName, command, errorMessage, endTime - startTime, maxScore)
  }

  core.setOutput('result', btoa(JSON.stringify(result)))
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
