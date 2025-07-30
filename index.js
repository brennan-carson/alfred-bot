require("dotenv").config();
const { Octokit } = require("@octokit/rest");
const OpenAI = require("openai");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const owner = process.env.REPO_OWNER;
const repo = process.env.REPO_NAME;

async function getChangedFiles(prNumber) {
  const { data } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  return data.map(file => ({
    filename: file.filename,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    status: file.status,
  }));
}

async function alfredAlreadyCommented(prNumber) {
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  return comments.some(comment => comment.body.trim().startsWith("🤖 **Alfred Summary**"));

}

async function summarizeAndCommentOnPR(pr) {
  if (await alfredAlreadyCommented(pr.number)) {
    console.log(`🟡 Alfred already commented on PR #${pr.number}, skipping...`);
    return;
  }

  const changedFiles = await getChangedFiles(pr.number);
  const fileSummary = changedFiles
    .map(file => `- \`${file.filename}\` (${file.status}, +${file.additions}/-${file.deletions})`)
    .join("\n");

  const prompt = `
You are Alfred, a helpful assistant that reviews GitHub pull requests.

Summarize the pull request below with these categories:
- Purpose
- Type of Change (bug fix, feature, docs, refactor, etc.)
- Important Files/Concepts
- Any meaningful content changes
- Call out possible merge conflicts if anything looks suspicious

PR Title: ${pr.title}
PR Description: ${pr.body || "No description provided."}

Files changed:
${fileSummary}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a GitHub PR assistant named Alfred." },
        { role: "user", content: prompt }
      ]
    });

    const summary = response.choices[0].message.content;

    const formattedComment = `🤖 **Alfred Summary**

${summary}

---

Posted automatically by Alfred, your friendly code assistant.`;

    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body: formattedComment,
    });

    console.log(`✅ Posted Alfred's comment to PR #${pr.number}`);
  } catch (error) {
    console.error(`❌ Error on PR #${pr.number}:`, error.message);
  }
}

async function listAndProcessPRs() {
  try {
    const { data: pullRequests } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
    });

    if (pullRequests.length === 0) {
      console.log("No open pull requests found.");
      return;
    }

    console.log("Open Pull Requests:");
    for (const pr of pullRequests) {
      console.log(`- [#${pr.number}] ${pr.title}`);
    }

    for (const pr of pullRequests) {
      await summarizeAndCommentOnPR(pr);
    }
  } catch (error) {
    console.error("❌ Error fetching PRs:", error.message);
  }
}

listAndProcessPRs();

