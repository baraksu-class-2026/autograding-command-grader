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
  const maxScoreForFile = maxScore / xmlFiles.length
  
  for (const xmlFile of xmlFiles) {
    const xmlPath = path.join(reportsDir, xmlFile)
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8')
    
    try {
      const result = await parseStringPromise(xmlContent)
      const testsuite = result.testsuite
      
      if (testsuite && testsuite.testcase) {
        const testcases = Array.isArray(testsuite.testcase) ? testsuite.testcase : [testsuite.testcase]
        
        // Get testsuite-level stats
        const testsuiteAttrs = testsuite.$
        const totalTests = parseInt(testsuiteAttrs.tests || 0)
        const skipped = parseInt(testsuiteAttrs.skipped || 0)
        const eligibleTests = totalTests - skipped
        const scorePerTest = eligibleTests > 0 ? maxScoreForFile / eligibleTests : 0
        
        testcases.forEach(testcase => {
          const attrs = testcase.$
          const classname = attrs.classname || ''
          const testName = attrs.name || ''
          const time = parseFloat(attrs.time || 0)
          
          const hasFailure = testcase.failure && testcase.failure.length > 0
          const status = hasFailure ? 'fail' : 'pass'
          const score = hasFailure ? 0 : scorePerTest
          
          let message = ''
          let testCode = ''
          if (hasFailure) {
            message = testcase.failure[0].$.message || 'Test failed'
            // Include all failure information in test_code
            const failureMessage = testcase.failure[0].$.message || ''
            const failureType = testcase.failure[0].$.type || ''
            const failureContent = testcase.failure[0]._ || ''
            testCode = `Failure Type: ${failureType}\nMessage: ${failureMessage}\n\nStack Trace:\n${failureContent}`
          }
          
          testResults.push({
            name: `${classname}.${testName}`,
            status,
            score,
            message,
            test_code: testCode,
            line_no: 0,
            duration: time * 1000, // Convert to milliseconds
          })
        })
      }
    } catch (error) {
      console.error(`Error parsing ${xmlFile}: ${error.message}`)
    }
  }
  
  return testResults
}

function generateXmlTestResult(xmlTests, maxScore) {
  if (xmlTests.length > 0) {
    const overallStatus = xmlTests.every(t => t.status === 'pass') ? 'pass' : 'fail'
    
    const result = {
      version: 1,
      status: overallStatus,
      max_score: maxScore,
      tests: xmlTests,
    }
    
    return result
  }
  return null
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
  let startTime = new Date()
  let endTime = new Date()
  let result

    const rootDir = process.env.GITHUB_WORKSPACE || process.cwd()
    // Check for XML test reports
    const reportsDir = path.join(rootDir, 'target', 'surefire-reports')

  try {
    if (!fs.existsSync(reportsDir) || fs.readdirSync(reportsDir).length === 0) {
      if (setupCommand) {
        execSync(setupCommand, {timeout, env, stdio: 'inherit'})
      }

      startTime = new Date()
      if (!fs.existsSync(reportsDir) || fs.readdirSync(reportsDir).length === 0) {
        output = execSync(command, {timeout, env, stdio: 'inherit'})?.toString()
      }
      endTime = new Date()
    }

    const xmlTests = await parseXmlReports(reportsDir, command, maxScore)
   
    result = generateXmlTestResult(xmlTests, maxScore)
    
    if (!result) {
      // Fallback to original behavior
      result = generateResult('pass', testName, command, output, endTime - startTime, maxScore)
    }
  } catch (error) {
    endTime = new Date()
    
    // Try to parse XML reports even on error
    const xmlTests = await parseXmlReports(reportsDir, command, maxScore)
    
    result = generateXmlTestResult(xmlTests, maxScore)
    
    if (!result) {
      const {status, errorMessage} = getErrorMessageAndStatus(error, command)
      result = generateResult(status, testName, command, errorMessage, endTime - startTime, maxScore)
    }
  }

  core.setOutput('result', btoa(JSON.stringify(result)))
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
