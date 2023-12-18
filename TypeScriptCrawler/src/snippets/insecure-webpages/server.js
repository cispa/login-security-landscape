const express = require('express')
const fs = require("fs")
const path = require('path')
const app = express()
const port = 3000

// Host CXSS tests
app.use("/cxss", express.static(path.join(__dirname, "cxss")))

// If existing, host PMForce tests
const pmtests = path.join(__dirname, "..", "pmxss", "pmforce", "tests");
if (fs.existsSync(pmtests)) {
    app.use("/pm", express.static(pmtests))
}

app.get('*', (req, res) => {
    res.status(404).send('Requested test page does not exist. Please specify valid page.')
})

app.listen(port, () => {
    console.log(`Started app listening on ${port}.`)
})
