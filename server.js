require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw body for signature verification
app.use(bodyParser.json({
  verify: (req, _, buf) => { req.rawBody = buf; }
}));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

// -- Helper Functions --

function verifySignature(req) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const [algo, hash] = sig.split('=');
  const hmac = crypto.createHmac(algo, process.env.WEBHOOK_SECRET);
  hmac.update(req.rawBody);
  return hash === hmac.digest('hex');
}

async function alfredAlreadyCommented(prNumber) {
  const { data: comments } = await octokit.issues.listComments({
    owner, repo, issue_number: prNumber
  });
  return comments.some(c => c.body.includes("🤖 Alfred Summary"));
}

async function getChangedFiles(prNumber) {
  const { data: files } = await octokit.pulls.listFiles({
    owner, repo, pull_number: prNumber
  });
  return files.map(f => `- \`${f.filename}\` (${f.status}, +${f.additions}/-${f.deletions})`);
}

async function summarizeAndCommentOnPR(pr) {
  if (await alfredAlreadyCommented(pr.number)) {
    console.log(`🟡 Skipping PR #${pr.number}: already commented`);
    return;
  }

  const files = await getChangedFiles(pr.number);
  const prompt = `
You are Alfred, a helpful assistant that reviews GitHub pull requests.

Summarize the pull request with:
- Purpose
- Type of Change (bug fix, feature, docs, refactor, etc.)
- Important Files/Concepts
- Notable code changes
- Warn if conflicts may be likely

PR Title: ${pr.title}
PR Body: ${pr.body || "No description provided."}

Files changed:
${files.join('\n')}
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Alfred, a GitHub assistant." },
        { role: "user", content: prompt }
      ]
    });
    const summary = res.choices[0].message.content;

    const body = `🤖 **Alfred Summary**

${summary}

---

Posted automatically by Alfred, your friendly code assistant.`;

    await octokit.issues.createComment({
      owner, repo, issue_number: pr.number, body
    });
    console.log(`✅ Commented on PR #${pr.number}`);
  } catch (err) {
    console.error(`❌ Failed to process PR #${pr.number}`, err);
  }
}

// -- Webhook Handler --

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    console.log("❌ Invalid webhook signature");
    return res.status(401).send("Invalid signature");
  }

  const payload = req.body;
  const action = payload.action;
  const pr = payload.pull_request;

  console.log(`📬 Event received: action=${action}, PR #${pr?.number}`);

  if (pr && ["opened", "synchronize", "reopened"].includes(action)) {
    await summarizeAndCommentOnPR(pr);
  }

  res.send("OK");
});

// -- Server Start --

app.listen(PORT, () => {
  console.log(`🚀 Alfred Server running on port ${PORT}`);
});

