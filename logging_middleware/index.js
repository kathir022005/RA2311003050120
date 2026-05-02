const axios = require("axios");

const BASE_URL = "http://20.207.122.201";
let _token = null;

function init(token) {
  _token = token;
}

async function Log(stack, level, pkg, message) {
  if (!_token) return;

  try {
    const res = await axios.post(
      BASE_URL + "/evaluation-service/logs",
      {
        stack: stack,
        level: level,
        package: pkg,
        message: String(message)
      },
      {
        headers: {
          Authorization: "Bearer " + _token,
          "Content-Type": "application/json"
        }
      }
    );
    return res.data;
  } catch (_) {}
}

module.exports = { init, Log };
