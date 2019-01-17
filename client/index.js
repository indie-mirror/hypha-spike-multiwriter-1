// Initial key generation
const session25519 = require('session25519')
const generateEFFDicewarePassphrase = require('eff-diceware-passphrase')

// Hypercore
const { Buffer } = require('buffer')
const ram = require('random-access-memory')
const hypercore = require('hypercore')

// From libsodium.
function to_hex(input) {
  // Disable input checking for this simple spike.
  // input = _any_to_Uint8Array(null, input, "input");
  var str = "",
    b,
    c,
    x;
  for (var i = 0; i < input.length; i++) {
    c = input[i] & 0xf;
    b = input[i] >>> 4;
    x =
      ((87 + c + (((c - 10) >> 8) & ~38)) << 8) |
      (87 + b + (((b - 10) >> 8) & ~38));
    str += String.fromCharCode(x & 0xff) + String.fromCharCode(x >>> 8);
  }
  return str;
}

// HTML elements.
const setupForm = document.getElementById('setupForm')
const changeButton = document.getElementById('change')
const indeterminateProgressIndicator = document.getElementById('indeterminateProgressIndicator')
const generatedTextField = document.getElementById('generated')
const hypercoreContentsTextArea = document.getElementById('hypercoreContents')
const errorsTextArea = document.getElementById('errors')
const publicSigningKeyTextField = document.getElementById('publicSigningKey')
const privateSigningKeyTextArea = document.getElementById('privateSigningKey')
const publicEncryptionKeyTextField = document.getElementById('publicEncryptionKey')
const privateEncryptionKeyTextField = document.getElementById('privateEncryptionKey')

function logError(error) {
  errorsTextArea.value += error
}

function generatePassphrase () {
  const passphrase = generateEFFDicewarePassphrase.entropy(100)
  setupForm.elements.passphrase.value = passphrase.join(' ')
  generateKeys()
}

function showProgressIndicator() {
  changeButton.style.display = 'none';
  indeterminateProgressIndicator.style.display = 'block';
}

function hideProgressIndicator() {
  changeButton.style.display = 'block';
  indeterminateProgressIndicator.style.display = 'none';
}

function clearOutputFields() {
  publicSigningKeyTextField.value = ''
  privateSigningKeyTextArea.value = ''
  publicEncryptionKeyTextField.value = ''
  privateEncryptionKeyTextField.value = ''
}

function generateKeys() {
  const passphrase = setupForm.elements.passphrase.value
  const domain = setupForm.elements.domain.value

  clearOutputFields()
  showProgressIndicator()

  let feed = null

  session25519(domain, passphrase, (error, keys) => {

    hideProgressIndicator()

    if (error) {
      logError(error.message)
      return
    }

    // Close the existing feed, if one exists.
    if (feed !== null) { feed.close() }

    //
    // Convert the keys first to ArrayBuffer and then to
    // Node’s implementation of Buffer, which is what
    // hypercore expected.
    //
    // If you try to pass an ArrayBuffer instead, you get
    // the following error:
    //
    // Error: key must be at least 16, was given undefined
    //
    const hypercoreReadKey = Buffer.from(keys.publicSignKey.buffer)
    const hypercoreWriteKey = Buffer.from(keys.secretSignKey.buffer)

    // Create a new hypercore using the newly-generated key material.
    feed = hypercore((filename) => ram(filename), hypercoreReadKey, {
      createIfMissing: false,
      overwrite: false,
      valueEncoding: 'json',
      secretKey: hypercoreWriteKey,
      storeSecretKey: false,
      onwrite: (index, data, peer, next) => {
        console.log(`Feed: [onWrite] index = ${index}, peer = ${peer}, data:`)
        console.log(data)
        next()
      }
    })

    feed.on('ready', () => {
      console.log('Feed: [Ready]')

      generatedTextField.value = 'Yes'

      if (!feed.writable) {
        generatedTextField.value = 'Yes (warning: but feed is not writable)'
        return
      }

      //
      // Note: the order of execution for an append appears to be:
      //
      // 1. onWrite handler (execution stops unless next() is called)
      // 2. feed’s on('append') handler
      // 3. feed.append callback function
      // 4. readStream’s on('data') handler
      //

      // Create a read stream
      const stream = feed.createReadStream({live:true})
      stream.on('data', (data) => {

        console.log('Feed [read stream, on data]' , data)

        // New data is available on the feed. Display it on the page.
        for (let [key, value] of Object.entries(data)) {
          hypercoreContentsTextArea.value += `${key}: ${value}\n`
        }
      })

      //
      // TEST
      //
      const NUMBER_TO_APPEND = 3
      let counter = 0

      Date.prototype.getUnixTime = function() { return this.getTime()/1000|0 };
      const updateInterval = setInterval(() => {
        counter++
        if (counter === NUMBER_TO_APPEND) {
          console.log(`Reached max number of items to append (${NUMBER_TO_APPEND}). Will not add any more.`)
          clearInterval(updateInterval)
        }

        const key = (new Date()).getUnixTime()
        const value = Math.random()*1000000000000000000 // simple random number
        let obj = {}
        obj[key] = value
        feed.append(obj, (error, sequence) => {
          console.log('Append callback')
          if (error) {
            logError(error)
            return
          }
          console.log('  Sequence', sequence)
        })
      }, 1000)
    })

    feed.on('error', (error) => {
      console.log(`Feed [Error] ${error}`)
      logError(error)
    })

    feed.on('download', (index, data) => {
      console.log(`Feed [Download] index = ${index}, data = ${data}`)
    })

    feed.on('upload', (index, data) => {
      console.log(`Feed [Upload] index = ${index}, data = ${data}`)
    })

    feed.on('append', () => {
      console.log('Feed [Append]')
    })

    feed.on('sync', () => {
      console.log('Feed sync')
    })

    feed.on('close', () => {
      console.log('Feed close')
    })

    // Display the keys.
    publicSigningKeyTextField.value = to_hex(keys.publicSignKey)
    privateSigningKeyTextArea.value = to_hex(keys.secretSignKey)
    publicEncryptionKeyTextField.value = to_hex(keys.publicKey)
    privateEncryptionKeyTextField.value = to_hex(keys.secretKey)
  })
}

// Main
document.addEventListener('DOMContentLoaded', () => {

  // Hide the progress indicator
  hideProgressIndicator()

  // Generate a passphrase at start
  generatePassphrase()

  // Update the passphrase (and keys) when the change button is pressed.
  setupForm.addEventListener('submit', (event) => {
    generatePassphrase()
    event.preventDefault()
  })
})
