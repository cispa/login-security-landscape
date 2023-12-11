/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Crawler from "../crawler";
import { Task } from "../crawler/taskqueue";

export class Module {
    name: string = "undefined";
    task?: Task;
    crawler?: Crawler;

    constructor() {

    }

    setup = async () => { };

    register = async (task: Task, crawler: Crawler) => {
        this.task = task;
        this.crawler = crawler;
    }
    before = async (page: any) => {
        if (!this.task) return;

    };
    execute = async (page: any) => {

    };
    finish = async (page: any) => {

    };

    clean = async () => { };
}