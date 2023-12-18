/* eslint-disable @typescript-eslint/no-explicit-any */
import { Session } from "../database/models/session";
import { SubjectType } from "../database/models/subject";

export interface Context {
    session_id: number;
    session_data: any;
}

export interface Task {
    id: any;
    url: string;
    url_id?: number;
    domain_id?: number;
    type: SubjectType;
    taskData: any;
    session?: Session;
    result?: any;
}