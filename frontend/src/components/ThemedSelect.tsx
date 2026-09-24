import {useEffect, useId, useLayoutEffect, useRef, useState} from "react";
import type {CSSProperties, KeyboardEvent} from "react";
import {createPortal} from "react-dom";

type Option = {value:string;label:string};
type Props = {label:string;value:string;options:Option[];onChange:(value:string)=>void;disabled?:boolean};

// Native WebKit/GTK select popups do not consistently inherit page colors.
// Keep focus on a select-only combobox and render its list in the app palette.
export function ThemedSelect({label,value,options,onChange,disabled=false}:Props) {
  const id=useId(),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const [position,setPosition]=useState<CSSProperties>({visibility:"hidden"});
  const search=useRef({text:"",at:0});
  const selected=Math.max(0,options.findIndex(option=>option.value===value));
  const expanded=open&&!disabled;
  const optionId=(index:number)=>`${id}-${index}`;
  const show=(index=selected)=>{search.current={text:"",at:0};setActive(index);setOpen(true)};
  const choose=(index:number)=>{
    const option=options[index];
    if(option&&option.value!==value)onChange(option.value);
    setOpen(false);
  };
  useEffect(()=>{if(disabled)setOpen(false)},[disabled]);
  useEffect(()=>{
    if(!expanded)return;
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!button.current?.contains(target)&&!menu.current?.contains(target))setOpen(false);
    };
    document.addEventListener("pointerdown",outside,true);
    return ()=>document.removeEventListener("pointerdown",outside,true);
  },[expanded]);
  useLayoutEffect(()=>{
    if(!expanded)return;
    const place=()=>{
      const anchor=button.current?.getBoundingClientRect();
      if(!anchor)return;
      const width=Math.min(Math.max(anchor.width,240),window.innerWidth-16);
      const below=window.innerHeight-anchor.bottom-12,above=anchor.top-12;
      const height=Math.min(280,options.length*34+10);
      const upwards=below<height&&above>below;
      setPosition({left:Math.max(8,Math.min(anchor.left,window.innerWidth-width-8)),width,
        maxHeight:Math.min(280,Math.max(40,upwards?above:below)),
        ...(upwards?{bottom:window.innerHeight-anchor.top+4}:{top:anchor.bottom+4})});
    };
    place();
    window.addEventListener("resize",place);
    // Follow the control if a containing panel scrolls; ignore listbox scrolling.
    const onScroll=(event:Event)=>{if(!menu.current?.contains(event.target as Node))place()};
    window.addEventListener("scroll",onScroll,true);
    return ()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",onScroll,true)};
  },[expanded,options.length]);
  useLayoutEffect(()=>{
    if(expanded)document.getElementById(optionId(active))?.scrollIntoView({block:"nearest"});
  },[expanded,active]);
  const onKeyDown=(event:KeyboardEvent<HTMLButtonElement>)=>{
    if(event.ctrlKey||event.metaKey)return;
    const key=event.key;
    if(key==="Tab"){setOpen(false);return}
    if(key==="Escape"){
      if(expanded){event.preventDefault();event.stopPropagation();setOpen(false)}
      return;
    }
    if(key==="ArrowDown"||key==="ArrowUp"||key==="Home"||key==="End"){
      event.preventDefault();event.stopPropagation();
      search.current={text:"",at:0};
      if(key==="Home"){show(0);return}
      if(key==="End"){show(options.length-1);return}
      if(!expanded){show();return}
      setActive(index=>Math.max(0,Math.min(options.length-1,index+(key==="ArrowDown"?1:-1))));
      return;
    }
    if(key==="Enter"||(key===" "&&Date.now()-search.current.at>700)){
      event.preventDefault();event.stopPropagation();
      if(expanded)choose(active);else show();
      return;
    }
    if(key.length===1&&!event.altKey){
      event.preventDefault();event.stopPropagation();
      const now=Date.now(),letter=key.toLocaleLowerCase();
      const text=now-search.current.at>700?letter:search.current.text+letter;
      search.current={text,at:now};
      const repeated=[...text].every(char=>char===letter),prefix=repeated?letter:text;
      const start=repeated?(expanded?active:selected)+1:(expanded?active:selected);
      for(let offset=0;offset<options.length;offset++){
        const index=(start+offset)%options.length;
        if(options[index].label.toLocaleLowerCase().startsWith(prefix)){setActive(index);setOpen(true);break}
      }
    }
  };
  return <>
    <button ref={button} type="button" className="themed-select" role="combobox" aria-label={label}
      aria-expanded={expanded} aria-haspopup="listbox" aria-controls={expanded?id:undefined}
      aria-activedescendant={expanded?optionId(active):undefined} disabled={disabled}
      onKeyDown={onKeyDown} onBlur={()=>setOpen(false)} onClick={()=>expanded?setOpen(false):show()}>
      <span>{options[selected]?.label??value}</span><span className="themed-select-caret" aria-hidden="true">▾</span>
    </button>
    {expanded&&createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="themed-select-list" style={position}
      onPointerDown={event=>event.preventDefault()}>
      {options.map((option,index)=><div key={option.value} id={optionId(index)} role="option" aria-selected={option.value===value}
        className={`themed-select-option${active===index?" active":""}`} onPointerMove={()=>setActive(index)} onClick={()=>choose(index)}>
        <span>{option.label}</span><span aria-hidden="true">{option.value===value?"✓":""}</span>
      </div>)}
    </div>,document.body)}
  </>;
}
