"""One execution or one explicit review per invocation; never auto-approve."""
import argparse
import json
from pathlib import Path
from services.computer.runtime import ROOT
from services.terminal.checklist import CommandChecklist
from services.terminal.executor import TerminalExecutor
from services.terminal.policy import TerminalError


def main():
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest='operation',required=True)
    sub.add_parser('next');sub.add_parser('status');sub.add_parser('export');sub.add_parser('elevate-next');sub.add_parser('collect-elevation')
    review=sub.add_parser('review');review.add_argument('receipt');review.add_argument('--reason',required=True)
    decision=review.add_mutually_exclusive_group(required=True);decision.add_argument('--approve',action='store_true');decision.add_argument('--reject',action='store_true')
    args=parser.parse_args();checklist=CommandChecklist(TerminalExecutor(ROOT/'.local/terminal'))
    try:
        if args.operation=='review':result=checklist.review(args.receipt,args.approve,args.reason)
        elif args.operation=='elevate-next':result=checklist.request_elevated_next()
        elif args.operation=='collect-elevation':result=checklist.collect_elevated_next()
        elif args.operation=='next':
            data=checklist.execute_next()
            result={'position':data['position'],'name':data['entry']['name'],'receipt_id':data['receipt']['id'],'exit_code':data['receipt']['exit_code'],'output':data['receipt']['output'][:1800],'criteria':data['criteria']} if not data.get('complete') else data
        else:result=checklist.status()
        checklist.markdown(ROOT/'docs/terminal-checklist.md')
        (ROOT/'tmp/terminal-research/checklist-status.json').write_text(json.dumps(checklist.status(),ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except TerminalError as error:
        checklist.markdown(ROOT/'docs/terminal-checklist.md')
        status=checklist.status();(ROOT/'tmp/terminal-research/checklist-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'executed':False,'error':str(error),'code':error.code,'status':status},ensure_ascii=False,indent=2))
        raise SystemExit(2)
    finally:checklist.close()


if __name__=='__main__':main()
