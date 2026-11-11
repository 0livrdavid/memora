#!/usr/bin/env node
// Standard MCP stdio client bridge. No filesystem/transcript access; app must run.
const net=require('node:net'),path=require('node:path');
const socket=path.resolve(__dirname,'../.local/memora-mcp.sock');const connection=net.createConnection(socket);let input='';connection.on('connect',()=>{process.stdin.pipe(connection);connection.pipe(process.stdout);});connection.on('error',()=>{process.stderr.write('Memora MCP indisponível. Abra o aplicativo Memora neste Mac.\n');process.exitCode=1;process.stdin.destroy();});connection.on('close',()=>{process.stdin.unpipe(connection);process.stdin.destroy();});process.stdin.on('end',()=>connection.end());process.on('SIGTERM',()=>{connection.destroy();process.exit(0);});
