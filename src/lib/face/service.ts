import {HttpError} from "@/lib/guard";
export async function getFaceSettings(){return {enabled:false,strictness:"normal",threshold:0};}
export class FaceMismatchError extends HttpError{constructor(public readonly distance:number){super(403,"PRO_REQUIRED","Face recognition memerlukan HRIS Pro.");}}
export async function verifyAttendanceFace(_employeeId:string,_photo:Buffer,_threshold:number):Promise<{distance:number;threshold:number}>{throw new FaceMismatchError(0);}
