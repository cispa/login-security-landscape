# To Auth or Not To Auth? A Comparative Analysis of the Pre- and Post-Login Security Landscape

This repository contains the code of our paper "To Auth or Not To Auth? A Comparative Analysis of the Pre- and Post-Login Security Landscape" [IEEE S&P 2024](https://www.computer.org/csdl/proceedings-article/sp/2024/313000a094/1Ub232sRVao).

Our code is organized into three distinct modules that can all run independently or together.
For a high-level description of the modules please see below. Detailed instructions for each module can be found in the respective folders.

## Setup

Run `git clone https://github.com/cispa/login-security-landscape --recurse-submodules`, then follow the instructions in the respective subproject folders.

## [AccountFramework](AccountFramework/README.md)

The AccountFramework helps conducting experiments with logged-in sessions.
It organizes the full process of finding registration options on websites, registering accounts for various identities, logging in and verifying that the login works, and the distribution of valid sessions to experiments.

Features:
- Automatic registration and login form finding
- Passwordmanager-supported registration task routines (requires manual input)
- Automatic login handling (with manual fallback option)
- Automatic login validation (with manual fallback option)
- Session and Account Management APIs for experiments

## [PythonCrawler](PythonCrawler/README.md)

The PythonCrawler is a modular crawling framework based on Playwright and implemented in Python.
The provided modules `HeadersExperiment` and `InclusionIssues` correspond to experiments `5.2 Security Headers` and `5.3 JavaScript Inclusions` in the paper.


## [TypeScriptCrawler](TypeScriptCrawler/README.md)

The TypeScriptCrawler is a modular crawling framework based on Playwright and implemented in TypeScript.
The provided modules `cxss` and `pmsecurity` correspond to experiments `5.1 Client-Side XSS` and `5.4 PostMessages` in the paper.

## Contact

If there are questions about our tools or paper, please either file an issue or contact `jannis.rautenstrauch (AT) cispa.de`.

## Research Paper

The paper is available at the [IEEE Computer Society Digital Library](https://www.computer.org/csdl/proceedings-article/sp/2024/313000a094/1Ub232sRVao). 
You can cite our work with the following BibTeX entry:
```latex
@inproceedings{rautenstrauch2024auth,
 author = {Rautenstrauch, Jannis and Mitkov, Metodi and Helbrecht, Thomas and Hetterich, Lorenz and Stock, Ben},
 booktitle = {IEEE Symposium on Security and Privacy},
 title = {{To Auth or Not To Auth? A Comparative Analysis of the Pre- and Post-Login Security Landscape}},
 year = {2024},
 doi = {10.1109/SP54263.2024.00094},
}
```
