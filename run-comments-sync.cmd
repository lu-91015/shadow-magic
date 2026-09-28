@echo off
cd /d c:\project\shadowleeProject
set "PATH=C:\Program Files\nodejs;%PATH%"
npm run sync:comments > .comments_all2.log 2> .comments_all2.err
