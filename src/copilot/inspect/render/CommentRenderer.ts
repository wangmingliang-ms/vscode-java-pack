/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Comment, Range, ExtensionContext, TextDocument, Uri, comments, CommentController, CommentMode, CommentThread } from "vscode";
import { Inspection } from "../Inspection";
import { InspectionRenderer } from "./InspectionRenderer";
import { logger, uncapitalize } from "../../../copilot/utils";
import path from "path";
import _ from "lodash";

export class CommentRenderer implements InspectionRenderer {
    private readonly threads: Map<Uri, CommentThread[]> = new Map();
    private commentController: CommentController | undefined;
    private context: ExtensionContext | undefined;

    public install(context: ExtensionContext): InspectionRenderer {
        if (this.commentController) return this;
        logger.debug(`[CommentRenderer] install`);
        this.commentController = comments.createCommentController('github-copilot-for-java', 'Rewriting Suggestions');
        context.subscriptions.push(this.commentController);
        this.context = context;
        return this;
    }

    public uninstall(): void {
        if (!this.commentController) return;
        logger.debug(`[CommentRenderer] uninstall`);
        this.threads.clear();
        this.commentController.dispose();
        this.commentController = undefined;
    }

    public clear(_document?: TextDocument): void {
        // no need to clear comments because they will be re-lined automatically.
    }

    public renderInspections(document: TextDocument, inspections: Inspection[]): void {
        if (!this.threads || !this.commentController) {
            return;
        }
        const oldThreads = this.threads.get(document.uri) ?? [];
        const oldComments = oldThreads.flatMap(t => t.comments) as InspectionComment[];
        const oldIds: string[] = _.uniq(oldComments).map(c => c.inspection.id);
        const newIds: string[] = inspections.map(i => i.id);
        const toKeep: CommentThread[] = _.intersection(oldIds, newIds)
            .map(id => oldThreads.find(t => t.comments.filter(c => (c as InspectionComment).inspection.id == id).length > 0)!);
        const toAdd: CommentThread[] = _.difference(newIds, oldIds).map(id => inspections.find(i => i.id === id)!).map(i => {
            const comment = this.toComment(i);
            const thread = this.commentController!.createCommentThread(document.uri, comment.range, [comment]);
            thread.canReply = false;
            thread.label = 'GitHub Copilot for Java';
            return thread;
        });
        // dispose threads that are not in the new inspections
        _.difference(oldIds, newIds)
            .map(id => oldThreads.find(t => t.comments.filter(c => (c as InspectionComment).inspection.id == id).length > 0)!)
            .forEach(i => i.dispose());

        const newThreads: CommentThread[] = [...toKeep, ...toAdd];
        this.threads.set(document.uri, newThreads);
    }

    private toComment(inspection: Inspection): InspectionComment {
        const range = Inspection.getIndicatorRangeOfInspection(inspection.problem);
        const iconPath = this.context ? Uri.file(path.join(this.context.asAbsolutePath('resources'), `copilot.svg`)) : undefined;
        const comment: InspectionComment = {
            inspection,
            range,
            mode: CommentMode.Preview,
            author: { name: 'Copilot', iconPath },
            body: `${inspection.problem.description}, maybe ${uncapitalize(inspection.solution)}`,
        };
        return comment;
    }
}

export interface InspectionComment extends Comment {
    inspection: Inspection;
    range: Range;
}
