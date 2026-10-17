// Markup ported from the Clyra Agents mockup. Each binding reads from `vm`, which the workspace builds from live API state.
import React from "react";
import { css, MockBloub, MockViewport } from "./mockupRuntime";

export function MockupMarkup({ vm }: { vm: Record<string, any> }) {
  const { actionCount, actions, asideRef, beamGlowStyle, beamMaskStyle, beamStyle, beamStyleB, beamTrailStyle, beamTrailStyleB, canTakeover, chatIdeas, chatKey, chatRows, chips, clearMq, closeCreate, closePreview, closeTpl, commitRename, countStyle, createBtnStyle, dColor, dateDay, dateLine, deleteLabel, draftName, draftPrompt, draftTitle, enterTo, exitTo, featTpls, feed, feedCount, feedEmpty, fileRef, files, focusTo, freshAvs, freshChat, freshSub, freshTitle, goHome, greeting, groupTyping, groupTypingLabel, hasAgentOpts, hasAgents, hasFiles, hasGroupOpts, hasNeeds, hasStamp, headAvs, headClick, headClickTitle, headIsChat, headIsPage, headKey, headTitle, headerMode, homeAgentOpts, homeGroupOpts, homeIdeas, homeMenuActionLabel, homeMenuStyle, homeNewGroup, homePlaceholder, homeRowStyle, homeSub, homeToAvs, homeToName, inChat, inMarket, inputParts, inputRef, isGroup, lineup, mBrowse, mEmpty, mEyebrow, mFilterTitle, mFiltered, mHasQ, mHero, mItems, mResultLabel, mShelves, mainPaneIconA, mainPaneIconB, mainSideIconA, mainSideIconB, marketRowStyle, mcats, memberCount, menuDelete, menuEdit, menuIsBot, menuRename, messages, mirrorRef, mq, multiTabs, nameRef, needs, needsCount, newMenuStyle, noActions, noAgents, noChats, noPal, noSuggest, onCaret, onDraftName, onDraftPrompt, onFiles, onHome, onKey, onMq, onRenameKey, onRenameVal, onSend, onSideQuery, onTaScroll, onText, onToBlur, onToFocus, onToKey, onToQuery, openCreate, openMarket, paletteHeading, paletteItems, paletteStyle, paneIconA, paneIconB, paneInnerStyle, paneScrollRef, paneSlotMain, paneTitle, paneWrapStyle, pickAgents, pickFiles, pickMode, pickSub, pickTitle, placeholder, plusBtnStyle, previewCardStyle, previewKey, previewOverlayStyle, promptCount, promptRows, pvAudio, pvExt, pvHasUrl, pvImg, pvImgStyle, pvMediaRef, pvMeta, pvName, pvOther, pvOtherNote, pvPdf, pvText, pvTextBody, pvThumbStyle, pvVideo, renameLabel, renameRef, renameVal, rowMenuStyle, saveAgent, saveLabel, scrimDown, scrimStyle, scrollRef, sendStyle, sheetStyle, sheetSub, showStarters, sideIconA, sideIconB, sideInnerStyle, sideQuery, sideSlotMain, sideTitle, sideWrapStyle, soloTyping, stamp, startGroup, starters, stop, suggestHeading, suggestStyle, suggestions, swatches, tabs, takeoverLabel, text, toBtnStyle, toChevStyle, toMode, toPlaceholder, toQuery, toRef, toggleHomeMenu, toggleNewMenu, togglePane, toggleSide, toggleTakeover, tplAdd, tplAddLabel, tplAddStyle, tplAsk, tplCaps, tplCardStyle, tplCat, tplColor, tplCount, tplExtra, tplGoals, tplIdle, tplInstalling, tplJob, tplName, tplOutput, tplOverlayStyle, tplQuality, tplRole, tplRules, tplSteps, tplTagline, tplTone, typingAvs, typingLabel, viewLive, vpAvs, vpCursors, vpMode, vpStatus, vpTitle } = vm;
  return (
<>
    <div style={{height: '100vh', minHeight: '420px', display: 'flex', background: '#FFFFFF', fontFamily: 'Calibri, Carlito, \'Segoe UI\', system-ui, sans-serif', WebkitFontSmoothing: 'antialiased', color: '#15171C', overflow: 'hidden', position: 'relative'}}>
      <div style={css(sideWrapStyle)}>
        <aside ref={asideRef} style={css(sideInnerStyle)}>
          <div data-newmenu="1" style={{position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', height: '48px', padding: '0 46px 0 16px'}}>
            <button className="mk1" onClick={goHome} title="Home" style={{display: 'flex', alignItems: 'center', height: '28px', padding: '0 8px', marginLeft: '-8px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.014em', color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1)'}}>
              Agents
            </button>
            <span style={{flex: 1}}></span>
            <button className="mk2 mk3" onClick={toggleNewMenu} title="New" style={css(plusBtnStyle)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
            </button>
            <div style={css(newMenuStyle)}>
              <button className="mk1" onClick={openCreate} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', flexShrink: 0}}>
                  <MockBloub shape="cercle" color="encre" size="24" busy="false" />
                </span>
                <span style={{display: 'flex', flexDirection: 'column', gap: '1px'}}>
                  <span style={{fontSize: '13px', fontWeight: 500, color: '#15171C'}}>
                    New agent
                  </span>
                  <span style={{fontSize: '11px', color: '#63676F'}}>
                    Name it, give it a job
                  </span>
                </span>
              </button>
              <button className="mk1" onClick={startGroup} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '9px', background: '#EDEEF1', color: '#15171C', flexShrink: 0}}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 18.5V17a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1.5"></path>
                    <circle cx="10" cy="7.5" r="3.2"></circle>
                    <path d="M16.5 4.6a3.2 3.2 0 0 1 0 5.8M19 18.5V17a4 4 0 0 0-2.4-3.7"></path>
                  </svg>
                </span>
                <span style={{display: 'flex', flexDirection: 'column', gap: '1px'}}>
                  <span style={{fontSize: '13px', fontWeight: 500, color: '#15171C'}}>
                    New group chat
                  </span>
                  <span style={{fontSize: '11px', color: '#63676F'}}>
                    Bring several agents in
                  </span>
                </span>
              </button>
            </div>
          </div>
          <span style={{position: 'absolute', top: '9px', right: '10px', zIndex: 5}}>
            <button className="mk4 mk5" onClick={toggleSide} title={sideTitle} style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={css(sideIconA)}>
                <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                <path d="M9 4v16"></path>
              </svg>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={css(sideIconB)}>
                <path d="M14.5 6.5L9 12l5.5 5.5"></path>
              </svg>
            </button>
          </span>
          <div style={{padding: '0 12px 6px'}}>
            <button className="mk1 mk6" onClick={goHome} style={css(homeRowStyle)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"></path>
              </svg>
              Home
            </button>
          </div>
          <div style={{padding: '2px 12px 10px'}}>
            <label className="mk1" style={{display: 'flex', alignItems: 'center', gap: '8px', height: '34px', padding: '0 12px', borderRadius: '10px', background: 'transparent', cursor: 'text', transition: 'background .28s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{color: '#8A8E96', flexShrink: 0}}>
                <circle cx="11" cy="11" r="6.6"></circle>
                <path d="M16 16l4 4"></path>
              </svg>
              <input type="text" placeholder="Search" value={sideQuery} onChange={onSideQuery} style={{flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: '13.5px', color: '#15171C'}} />
            </label>
          </div>
          <div style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: '2px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.16) transparent'}}>
            {(chatRows || []).map((c, idx) => (
              <React.Fragment key={idx}>
                <div onClick={c.onOpen} onMouseEnter={c.onEnter} onMouseLeave={c.onLeave} style={css(c.style)}>
                  <button className="mk7" data-rowmenu="1" onClick={c.onDots} title="More" style={css(c.dotsStyle)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5.5" cy="12" r="1.7"></circle>
                      <circle cx="12" cy="12" r="1.7"></circle>
                      <circle cx="18.5" cy="12" r="1.7"></circle>
                    </svg>
                  </button>
                  <span style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', flexShrink: 0}}>
                    {(c.avs || []).map((v, idx) => (
                      <React.Fragment key={idx}>
                        <span style={css(v.wrap)}>
                          <MockBloub shape={v.shape} color={v.color} size={v.size} busy={v.busy} />
                        </span>
                      </React.Fragment>
                    ))}
                  </span>
                  <span style={{display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0}}>
                    <span style={{display: 'flex', alignItems: 'baseline', gap: '8px'}}>
                      {c.notRenaming && (
                        <>
                        <span style={{flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                          {c.title}
                        </span>
                        </>
                      )}
                      {c.renaming && (
                        <>
                        <input ref={renameRef} type="text" maxLength={40} value={renameVal} onChange={onRenameVal} onKeyDown={onRenameKey} onBlur={commitRename} onClick={stop} style={{flex: 1, minWidth: 0, height: '24px', margin: '-3px 0', padding: '0 9px', border: 'none', borderRadius: '999px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1.5px rgba(30,111,255,0.55)', fontFamily: 'inherit', fontSize: '14px', fontWeight: 500, letterSpacing: '-0.01em', color: '#15171C', animation: 'clyraFade .18s ease both'}} />
                        </>
                      )}
                      <span style={css(c.timeStyle)}>
                        {c.time}
                      </span>
                    </span>
                    <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <span style={css(c.previewStyle)}>
                        {c.preview}
                      </span>
                      {c.unread && (
                        <>
                        <span style={{display: 'block', width: '8px', height: '8px', borderRadius: '999px', background: '#1E6FFF', flexShrink: 0}}></span>
                        </>
                      )}
                    </span>
                  </span>
                </div>
              </React.Fragment>
            ))}
            {noChats && (
              <>
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '4px', padding: '36px 16px 0', animation: 'clyraThinkIn .5s cubic-bezier(.32,.72,0,1) both'}}>
                <MockBloub shape="cercle" color="gris" size="44" busy="false" />
                <span style={{marginTop: '12px', fontSize: '14.5px', fontWeight: 700, color: '#15171C'}}>
                  No agents yet
                </span>
                <span style={{fontSize: '13px', lineHeight: 1.45, color: '#7A7E87', textWrap: 'pretty'}}>
                  Your agents and chats show up here.
                </span>
                <button className="mk8 mk9" onClick={openCreate} style={{display: 'flex', alignItems: 'center', gap: '6px', height: '32px', marginTop: '14px', padding: '0 14px 0 11px', borderRadius: '999px', border: 'none', background: '#15171C', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 700, color: '#FFFFFF', transition: 'transform .22s cubic-bezier(.32,.72,0,1), filter .2s ease'}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14"></path>
                  </svg>
                  New agent
                </button>
              </div>
              </>
            )}
          </div>
          <div style={{padding: '8px 12px 12px', borderTop: '1px solid rgba(16,18,24,0.06)'}}>
            <button className="mk1 mk6" onClick={openMarket} style={css(marketRowStyle)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9.5l1.4-4.2A1.5 1.5 0 0 1 6.8 4.3h10.4a1.5 1.5 0 0 1 1.4 1l1.4 4.2"></path>
                <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"></path>
                <path d="M5.5 12.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6.5M10 20v-4.5h4V20"></path>
              </svg>
              <span style={{flex: 1, textAlign: 'left'}}>
                Marketplace
              </span>
              <span style={{fontSize: '11.5px', fontWeight: 700, color: '#8A8E96', fontVariantNumeric: 'tabular-nums'}}>
                {tplCount}
              </span>
            </button>
          </div>
          <div data-rowmenu="1" style={css(rowMenuStyle)}>
            <button className="mk1" onClick={menuRename} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', height: '34px', padding: '0 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500, color: '#15171C', textAlign: 'left', transition: 'background .26s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{color: '#5F636B'}}>
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"></path>
                <path d="M13.5 6.5l4 4"></path>
              </svg>
              {renameLabel}
            </button>
            {menuIsBot && (
              <>
              <button className="mk1" onClick={menuEdit} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', height: '34px', padding: '0 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500, color: '#15171C', textAlign: 'left', transition: 'background .26s cubic-bezier(.32,.72,0,1)'}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{color: '#5F636B'}}>
                  <circle cx="12" cy="12" r="8.5"></circle>
                  <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"></path>
                </svg>
                Edit job and color
              </button>
              </>
            )}
            <span style={{display: 'block', height: '1px', margin: '4px 8px', background: 'rgba(16,18,24,0.07)'}}></span>
            <button className="mk10" onClick={menuDelete} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', height: '34px', padding: '0 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500, color: '#D0342C', textAlign: 'left', transition: 'background .26s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"></path>
              </svg>
              {deleteLabel}
            </button>
          </div>
        </aside>
      </div>
      <main style={{flex: '1 1 auto', minWidth: '380px', display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', background: 'radial-gradient(120% 90% at 50% 0%, #FCFCFD 0%, #F8F9FA 58%, #F3F4F6 100%)'}}>
        <div data-to="1" style={{position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', gap: '10px', minHeight: '60px', padding: '6px 10px 6px 10px', borderBottom: '1px solid transparent', background: 'transparent'}}>
          <span style={css(sideSlotMain)}>
            <button className="mk4 mk5" onClick={toggleSide} title={sideTitle} style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={css(mainSideIconA)}>
                <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                <path d="M9 4v16"></path>
              </svg>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={css(mainSideIconB)}>
                <path d="M14.5 6.5L9 12l5.5 5.5"></path>
              </svg>
            </button>
          </span>
          {headerMode && (
            <>
            <span style={{flex: 1}}></span>
            <div key={headKey} style={{position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', maxWidth: '46%', display: 'flex', justifyContent: 'center', animation: 'clyraFade .4s cubic-bezier(.32,.72,0,1) both'}}>
              {headIsChat && (
                <>
                <button className="mk11" onClick={headClick} title={headClickTitle} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: 0, maxWidth: '100%', padding: '4px 14px 5px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity .2s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                  <span style={{position: 'relative', display: 'flex', alignItems: 'center'}}>
                    {(headAvs || []).map((v, idx) => (
                      <React.Fragment key={idx}>
                        <span style={css(v.wrap)}>
                          <MockBloub shape={v.shape} color={v.color} size={v.size} busy={v.busy} />
                        </span>
                      </React.Fragment>
                    ))}
                  </span>
                  <span style={{display: 'flex', alignItems: 'center', gap: '3px', minWidth: 0, maxWidth: '100%'}}>
                    <span style={{fontSize: '12.5px', fontWeight: 700, letterSpacing: '-0.006em', color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                      {headTitle}
                    </span>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9DA1A9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}}>
                      <path d="M9 5.5l6.5 6.5L9 18.5"></path>
                    </svg>
                  </span>
                  {isGroup && (
                    <>
                    <span style={{marginTop: '-2px', fontSize: '11px', color: '#8A8E96'}}>
                      {memberCount}
                    </span>
                    </>
                  )}
                </button>
                </>
              )}
              {headIsPage && (
                <>
                <span style={{fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em', color: '#15171C'}}>
                  {headTitle}
                </span>
                </>
              )}
            </div>
            <button className="mk4" onClick={enterTo} title="Add agents" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="8" r="3.4"></circle>
                <path d="M3.8 19v-1.2a4.3 4.3 0 0 1 4.3-4.3h3.8M18 13v6M15 16h6"></path>
              </svg>
            </button>
            </>
          )}
          {toMode && (
            <>
            <div onClick={focusTo} style={{flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', minHeight: '34px', cursor: 'text'}}>
              <span style={{fontSize: '14px', color: '#7A7E87', marginRight: '2px'}}>
                To:
              </span>
              {(chips || []).map((c, idx) => (
                <React.Fragment key={idx}>
                  <span style={{display: 'flex', alignItems: 'center', gap: '5px', height: '26px', padding: '0 3px 0 4px', borderRadius: '999px', background: 'rgba(30,111,255,0.1)', color: '#0B54D6', fontSize: '13.5px', fontWeight: 500, letterSpacing: '-0.006em', animation: 'clyraRise .34s cubic-bezier(.16,1,.3,1) both'}}>
                    <MockBloub shape={c.av.shape} color={c.av.color} size="18" busy="false" />
                    {c.name}
                    <button className="mk12" onClick={c.onRemove} title="Remove" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#0B54D6', opacity: '.6', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18"></path>
                      </svg>
                    </button>
                  </span>
                </React.Fragment>
              ))}
              <input ref={toRef} type="text" placeholder={toPlaceholder} value={toQuery} onChange={onToQuery} onKeyDown={onToKey} onFocus={onToFocus} onBlur={onToBlur} autoComplete="off" style={{flex: 1, minWidth: '80px', height: '26px', border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: '14px', color: '#15171C', caretColor: '#1E6FFF'}} />
            </div>
            <button className="mk9" onClick={exitTo} style={{height: '28px', padding: '0 12px', borderRadius: '999px', border: 'none', background: '#1E6FFF', color: '#FFFFFF', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: 500, cursor: 'pointer', flexShrink: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
              Done
            </button>
            </>
          )}
          <span style={css(paneSlotMain)}>
            <button className="mk4 mk5" onClick={togglePane} title={paneTitle} style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={css(mainPaneIconA)}>
                <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                <path d="M15 4v16"></path>
              </svg>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={css(mainPaneIconB)}>
                <path d="M9.5 6.5L15 12l-5.5 5.5"></path>
              </svg>
            </button>
          </span>
          <div style={css(suggestStyle)}>
            <span style={{display: 'block', padding: '9px 12px 6px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#5F636B'}}>
              {suggestHeading}
            </span>
            {noSuggest && (
              <>
              <span style={{display: 'block', padding: '6px 12px 10px', fontSize: '12.5px', color: '#63676F'}}>
                No agents match that name.
              </span>
              </>
            )}
            <div style={{display: 'flex', flexDirection: 'column', maxHeight: '300px', overflowY: 'auto'}}>
              {(suggestions || []).map((s, idx) => (
                <React.Fragment key={idx}>
                  <button className="mk1" onMouseDown={s.onPick} style={css(s.style)}>
                    <MockBloub shape={s.av.shape} color={s.av.color} size="28" busy="false" />
                    <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, textAlign: 'left', minWidth: 0}}>
                      <span style={{fontSize: '13px', fontWeight: 500, color: '#15171C'}}>
                        {s.name}
                      </span>
                      <span style={{fontSize: '11px', color: '#63676F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        {s.role}
                      </span>
                    </span>
                    <span style={css(s.hintStyle)}>
                      ↵
                    </span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        {inChat && (
          <>
          <div ref={scrollRef} style={{flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '20px 24px 24px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.16) transparent'}}>
            <div key={chatKey} style={{maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 2px', animation: 'clyraChatIn .5s cubic-bezier(.32,.72,0,1) both'}}>
              {hasStamp && (
                <>
                <span style={{display: 'block', textAlign: 'center', fontSize: '12px', color: '#7A7E87', padding: '2px 0 4px'}}>
                  {stamp}
                </span>
                </>
              )}
              {pickMode && (
                <>
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6vh 0 8px', animation: 'clyraThinkIn .5s cubic-bezier(.32,.72,0,1) both'}}>
                  <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', borderRadius: '999px', background: '#FFFFFF', color: '#15171C', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07), 0 6px 16px -8px rgba(16,18,24,0.2)'}}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20l1.2-3.6A8 8 0 1 1 8 19.1z"></path>
                      <path d="M12 9v6M9 12h6"></path>
                    </svg>
                  </span>
                  <span style={{display: 'block', marginTop: '16px', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, textWrap: 'balance'}}>
                    {pickTitle}
                  </span>
                  <span style={{display: 'block', marginTop: '8px', maxWidth: '420px', fontSize: '14.5px', lineHeight: 1.5, color: '#63676F', textWrap: 'pretty'}}>
                    {pickSub}
                  </span>
                </div>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: '8px', width: '100%', marginTop: '14px'}}>
                  {(pickAgents || []).map((p, idx) => (
                    <React.Fragment key={idx}>
                      <button className="mk13 mk14" onMouseDown={p.onToggle} style={css(p.style)}>
                        <span style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                          <MockBloub shape="cercle" color={p.color} size="32" busy={p.busy} />
                          <span style={css(p.checkStyle)}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5"></path>
                            </svg>
                          </span>
                        </span>
                        <span style={{display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', minWidth: 0}}>
                          <span style={{fontSize: '14px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {p.name}
                          </span>
                          <span style={{fontSize: '12.5px', lineHeight: 1.4, color: '#7A7E87', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
                            {p.prompt}
                          </span>
                        </span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                </>
              )}
              {freshChat && (
                <>
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '10vh 0 0', animation: 'clyraThinkIn .55s cubic-bezier(.32,.72,0,1) both'}}>
                  <span style={{display: 'flex', alignItems: 'center'}}>
                    {(freshAvs || []).map((v, idx) => (
                      <React.Fragment key={idx}>
                        <span style={css(v.wrap)}>
                          <MockBloub shape="cercle" color={v.color} size="56" busy={v.busy} />
                        </span>
                      </React.Fragment>
                    ))}
                  </span>
                  <span style={{display: 'block', marginTop: '18px', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, textWrap: 'balance'}}>
                    {freshTitle}
                  </span>
                  <span style={{display: 'block', marginTop: '8px', maxWidth: '440px', fontSize: '14.5px', lineHeight: 1.5, color: '#63676F', textWrap: 'pretty'}}>
                    {freshSub}
                  </span>
                  <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px', marginTop: '20px'}}>
                    {(chatIdeas || []).map((i, idx) => (
                      <React.Fragment key={idx}>
                        <button className="mk15 mk16" onClick={i.onPick} style={{display: 'flex', alignItems: 'center', gap: '7px', height: '32px', padding: '0 13px 0 10px', borderRadius: '999px', border: 'none', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', color: '#3A3D44', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.08)', transition: 'background .22s ease, transform .22s cubic-bezier(.16,1,.3,1), color .22s ease'}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: '#1E6FFF'}}>
                            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path>
                          </svg>
                          {i.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                </>
              )}
              {(messages || []).map((m, idx) => (
                <React.Fragment key={idx}>
                  <div style={css(m.rowStyle)}>
                    {m.isMe && (
                      <>
                      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', maxWidth: '72%', minWidth: 0}}>
                        {m.hasTools && (
                          <>
                          <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px'}}>
                            {(m.tools || []).map((t, idx) => (
                              <React.Fragment key={idx}>
                                <span style={{display: 'flex', alignItems: 'center', gap: '5px', height: '24px', padding: '0 9px 0 7px', borderRadius: '999px', background: 'rgba(30,111,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(30,111,255,0.12)', color: '#0B54D6', fontSize: '12px', fontWeight: 600, letterSpacing: '-0.004em', whiteSpace: 'nowrap'}}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d={t.icon}></path>
                                  </svg>
                                  {t.label}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                          </>
                        )}
                        {m.hasImgs && (
                          <>
                          <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px', maxWidth: '100%'}}>
                            {(m.imgs || []).map((f, idx) => (
                              <React.Fragment key={idx}>
                                <button className="mk17 mk6" onClick={f.onOpen} title={f.name} style={css(f.style)}>
                                  <span style={css(f.imgStyle)}></span>
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                          </>
                        )}
                        {m.hasDocs && (
                          <>
                          <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px', maxWidth: '100%'}}>
                            {(m.docs || []).map((f, idx) => (
                              <React.Fragment key={idx}>
                                <button className="mk18 mk14" onClick={f.onOpen} style={{display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '260px', padding: '6px 14px 6px 6px', borderRadius: '999px', border: 'none', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.08), 0 4px 12px -8px rgba(16,18,24,0.2)', transition: 'background .28s cubic-bezier(.32,.72,0,1), transform .25s cubic-bezier(.16,1,.3,1)'}}>
                                  <span style={css(f.thumbStyle)}>
                                    {f.ext}
                                  </span>
                                  <span style={{display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0}}>
                                    <span style={{fontSize: '13px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                      {f.name}
                                    </span>
                                    <span style={{fontSize: '11.5px', color: '#7A7E87'}}>
                                      {f.meta}
                                    </span>
                                  </span>
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                          </>
                        )}
                        {m.hasText && (
                          <>
                          <div style={{maxWidth: '100%', padding: '11px 16px', borderRadius: '20px', background: 'rgba(16,18,24,0.055)', color: '#15171C', fontSize: '15px', lineHeight: 1.5, letterSpacing: '-0.004em', textWrap: 'pretty'}}>
                            {(m.parts || []).map((p, idx) => (
                              <React.Fragment key={idx}>
                                {p.isTok && (
                                  <>
                                  <span style={{whiteSpace: 'nowrap'}}>
                                    <span style={{display: 'inline-block', marginRight: '4px', verticalAlign: '-2px', color: '#15171C'}}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d={p.icon}></path>
                                      </svg>
                                    </span>
                                    <span style={{color: '#1E6FFF', fontWeight: 700}}>
                                      {p.label}
                                    </span>
                                  </span>
                                  </>
                                )}
                                {p.isText && (
                                  <>
                                  {p.text}
                                  </>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                          </>
                        )}
                      </div>
                      </>
                    )}
                    {m.isAgent && (
                      <>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '78%', minWidth: 0}}>
                        {m.showName && (
                          <>
                          <span style={{display: 'flex', alignItems: 'center', gap: '7px', padding: '0 4px'}}>
                            <MockBloub shape={m.av.shape} color={m.av.color} size="18" busy="false" />
                            <span style={{fontSize: '12px', fontWeight: 500, color: '#63676F', letterSpacing: '-0.004em'}}>
                              {m.name}
                            </span>
                          </span>
                          </>
                        )}
                        {m.isText && (
                          <>
                          <div style={{padding: '2px 4px', fontSize: '14.5px', lineHeight: 1.55, letterSpacing: '-0.01em', color: '#15171C', textWrap: 'pretty'}}>
                            {m.text}
                            {m.hasLink && (
                              <>
                              <a href="#" style={{color: '#1E6FFF'}}>
                                {m.link}
                              </a>
                              {m.post}
                              </>
                            )}
                          </div>
                          </>
                        )}
                        {m.isFile && (
                          <>
                          <div style={{display: 'flex', alignItems: 'center', gap: '10px', width: '236px', padding: '8px 10px 8px 8px', borderRadius: '16px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07), 0 4px 12px -8px rgba(16,18,24,0.18)'}}>
                            <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '10px', background: '#FCEBEA', color: '#C4372B', fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.02em', flexShrink: 0}}>
                              PDF
                            </span>
                            <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0}}>
                              <span style={{fontSize: '12.5px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                {m.fileName}
                              </span>
                              <span style={{fontSize: '11px', color: '#63676F'}}>
                                {m.fileMeta}
                              </span>
                            </span>
                            <button className="mk2" title="Download" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"></path>
                              </svg>
                            </button>
                          </div>
                          </>
                        )}
                      </div>
                      </>
                    )}
                  </div>
                </React.Fragment>
              ))}
              {groupTyping && (
                <>
                <div style={{display: 'flex', alignItems: 'center', gap: '9px', width: '100%', padding: '2px 4px', animation: 'clyraThinkIn .55s cubic-bezier(.32,.72,0,1) both'}}>
                  <span style={{display: 'flex', alignItems: 'center'}}>
                    {(typingAvs || []).map((v, idx) => (
                      <React.Fragment key={idx}>
                        <span style={css(v.wrap)}>
                          <MockBloub shape="cercle" color={v.color} size="20" busy={v.busy} />
                        </span>
                      </React.Fragment>
                    ))}
                  </span>
                  <span style={{fontSize: '13px', fontWeight: 500, color: '#63676F', letterSpacing: '-0.006em'}}>
                    {groupTypingLabel}
                  </span>
                  <span style={{display: 'flex', alignItems: 'center', gap: '3px', height: '24px', padding: '0 9px', borderRadius: '999px', background: 'rgba(16,18,24,0.055)'}}>
                    <span style={{display: 'block', width: '5px', height: '5px', borderRadius: '999px', background: '#5F636B', animation: 'clyraDot 1.2s ease-in-out infinite'}}></span>
                    <span style={{display: 'block', width: '5px', height: '5px', borderRadius: '999px', background: '#5F636B', animation: 'clyraDot 1.2s ease-in-out .15s infinite'}}></span>
                    <span style={{display: 'block', width: '5px', height: '5px', borderRadius: '999px', background: '#5F636B', animation: 'clyraDot 1.2s ease-in-out .3s infinite'}}></span>
                  </span>
                </div>
                </>
              )}
              {soloTyping && (
                <>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '2px 4px', animation: 'clyraThinkIn .55s cubic-bezier(.32,.72,0,1) both'}}>
                  <span style={{display: 'inline-block', fontFamily: 'Calibri, Carlito, \'Segoe UI\', system-ui, sans-serif', fontSize: '16px', fontWeight: 400, letterSpacing: 0, color: 'transparent', backgroundImage: 'linear-gradient(110deg, #A8ACB4 0%, #A8ACB4 30%, #0E1014 48%, #0E1014 52%, #A8ACB4 70%, #A8ACB4 100%)', backgroundSize: '220% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', animation: 'clyraThinkIn .6s cubic-bezier(.32,.72,0,1) both, clyraShine 4.2s linear infinite'}}>
                    {typingLabel}
                  </span>
                </div>
                </>
              )}
            </div>
          </div>
          <div style={{padding: '0 24px 18px'}}>
            <div style={{position: 'relative', width: '100%', maxWidth: '640px', margin: '0 auto', borderRadius: '32px', background: '#FFFFFF', boxShadow: '0 1px 1px rgba(16,18,24,0.03), 0 8px 20px -8px rgba(16,18,24,0.10), 0 30px 60px -28px rgba(16,18,24,0.20), inset 0 0 0 1px rgba(16,18,24,0.055)'}}>
              <span aria-hidden="true" style={css(beamMaskStyle)}>
                <span style={css(beamStyle)}></span>
                <span style={css(beamTrailStyle)}></span>
                <span style={css(beamStyleB)}></span>
                <span style={css(beamTrailStyleB)}></span>
              </span>
              <span aria-hidden="true" style={css(beamGlowStyle)}></span>
              <div data-palette="1" style={css(paletteStyle)}>
                <span style={{display: 'block', padding: '9px 12px 6px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#5F636B'}}>
                  {paletteHeading}
                </span>
                {noPal && (
                  <>
                  <span style={{display: 'block', padding: '6px 12px 12px', fontSize: '12.5px', color: '#63676F'}}>
                    No tools match that.
                  </span>
                  </>
                )}
                <div style={{display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain', maxHeight: '320px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent'}}>
                  {(paletteItems || []).map((c, idx) => (
                    <React.Fragment key={idx}>
                      <button className="mk19" onMouseDown={c.onPick} onMouseEnter={c.onEnter} style={css(c.style)}>
                        <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '9px', background: '#F1F2F4', color: '#3A3D44', flexShrink: 0}}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d={c.icon}></path>
                          </svg>
                        </span>
                        <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, textAlign: 'left', minWidth: 0}}>
                          <span style={{fontSize: '13px', fontWeight: 500, color: '#15171C', letterSpacing: '-0.008em'}}>
                            {c.label}
                          </span>
                          <span style={{fontSize: '11px', color: '#63676F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {c.desc}
                          </span>
                        </span>
                        <span style={css(c.hintStyle)}>
                          Added
                        </span>
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div style={{position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px 14px 12px 18px'}}>
                {hasFiles && (
                  <>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '0 2px 2px'}}>
                    {(files || []).map((fl, idx) => (
                      <React.Fragment key={idx}>
                        <span className="mk20" style={css(fl.style)}>
                          <button onClick={fl.onOpen} title="Preview" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', borderRadius: '999px', background: 'transparent', cursor: 'pointer', padding: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}></button>
                          <span style={css(fl.thumbStyle)}>
                            {fl.isImg && (
                              <>
                              <span style={css(fl.imgStyle)}></span>
                              </>
                            )}
                            {fl.noImg && (
                              <>
                              {fl.ext}
                              </>
                            )}
                          </span>
                          <span style={{display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, pointerEvents: 'none'}}>
                            <span style={{fontSize: '12.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '130px'}}>
                              {fl.name}
                            </span>
                            <span style={{fontSize: '11px', color: '#63676F'}}>
                              {fl.meta}
                            </span>
                          </span>
                          <button className="mk21 mk22" onClick={fl.onRemove} title="Remove" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2, width: '18px', height: '18px', borderRadius: '999px', border: 'none', background: 'rgba(16,18,24,0.07)', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .26s cubic-bezier(.32,.72,0,1), color .18s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                              <path d="M6 6l12 12M18 6L6 18"></path>
                            </svg>
                          </button>
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                  </>
                )}
                <div style={{position: 'relative', width: '100%'}}>
                  <div ref={mirrorRef} aria-hidden="true" style={{width: '100%', border: 'none', fontFamily: 'inherit', fontSize: '15.5px', lineHeight: '24px', height: '48px', letterSpacing: '-0.011em', padding: '0 4px', boxSizing: 'border-box', position: 'absolute', left: 0, top: 0, pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden', color: '#15171C'}}>
                    {(inputParts || []).map((p, idx) => (
                      <React.Fragment key={idx}>
                        {p.isTok && (
                          <>
                          <span key={p.key} style={css(p.tokStyle)}>
                            <span style={{display: 'inline-block', width: '1em', textAlign: 'left', verticalAlign: '-2px', color: '#15171C'}}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d={p.icon}></path>
                              </svg>
                            </span>
                            {p.label}
                          </span>
                          </>
                        )}
                        {p.isText && (
                          <>
                          {p.text}
                          </>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <textarea ref={inputRef} rows={2} placeholder={placeholder} value={text} onChange={onText} onKeyDown={onKey} onSelect={onCaret} onKeyUp={onCaret} onClick={onCaret} onScroll={onTaScroll} style={{width: '100%', border: 'none', background: 'transparent', resize: 'none', fontFamily: 'inherit', fontSize: '15.5px', lineHeight: '24px', height: '48px', letterSpacing: '-0.011em', padding: '0 4px', boxSizing: 'border-box', position: 'relative', color: 'transparent', caretColor: '#15171C'}}></textarea>
                </div>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0}}>
                    <button className="mk23 mk24" title="Add files" onClick={pickFiles} style={{width: '34px', height: '34px', borderRadius: '999px', border: '1px solid transparent', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#5C6069', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .2s cubic-bezier(.2,.8,.3,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                    </button>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                    <button className="mk1 mk3" title="Dictate" style={{width: '34px', height: '34px', borderRadius: '999px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'transparent', color: '#5C6069', transition: 'background .3s cubic-bezier(.2,.8,.3,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                        <rect x="9" y="3" width="6" height="11" rx="3"></rect>
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>
                      </svg>
                    </button>
                    <button className="mk25 mk3" title="Send" onClick={onSend} style={css(sendStyle)}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19V6M6 12l6-6 6 6"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
        )}
        {onHome && (
          <>
          <div style={{position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent', animation: 'clyraChatIn .5s cubic-bezier(.32,.72,0,1) both'}}>
            <div style={{position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100%', boxSizing: 'border-box'}}>
              <span aria-hidden="true" style={{position: 'absolute', left: '50%', top: '4%', width: 'min(820px, 110%)', height: '420px', transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(30,111,255,0.10), rgba(99,102,241,0.045) 50%, rgba(30,111,255,0) 100%)', pointerEvents: 'none'}}></span>
              <span aria-hidden="true" style={{position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(16,18,24,0.07) 1px, transparent 1.2px)', backgroundSize: '22px 22px', WebkitMaskImage: 'radial-gradient(ellipse 60% 45% at 50% 30%, #000 0%, transparent 100%)', maskImage: 'radial-gradient(ellipse 60% 45% at 50% 30%, #000 0%, transparent 100%)', pointerEvents: 'none'}}></span>
              <div style={{position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '640px', margin: '0 auto', padding: '48px 24px 48px', boxSizing: 'border-box'}}>
                <span style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', marginBottom: '26px', textAlign: 'center', animation: 'clyraThinkIn .6s cubic-bezier(.32,.72,0,1) both'}}>
                  <span style={{fontSize: '13px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#15171C'}}>
                    {dateDay}
                  </span>
                  <span style={{fontSize: '12.5px', fontWeight: 400, letterSpacing: '0.02em', color: '#9DA1A9', fontVariantNumeric: 'tabular-nums'}}>
                    {dateLine}
                  </span>
                </span>
                <div style={{position: 'relative', display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-end', justifyContent: 'center', gap: 0, maxWidth: '100%', minHeight: '56px'}}>
                  <span aria-hidden="true" style={{position: 'absolute', left: '8%', right: '8%', bottom: '-6px', height: '14px', borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(16,18,24,0.10), rgba(16,18,24,0))', pointerEvents: 'none'}}></span>
                  {(lineup || []).map((b, idx) => (
                    <React.Fragment key={idx}>
                      <button onClick={b.onOpen} title={b.name} style={css(b.style)}>
                        <MockBloub shape="cercle" color={b.color} size={b.size} busy={b.busy} />
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                <span style={{display: 'block', marginTop: '24px', fontSize: '38px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, color: '#15171C', textAlign: 'center', textWrap: 'balance', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .08s both'}}>
                  {greeting}, Luke
                </span>
                <span style={{display: 'block', marginTop: '8px', maxWidth: '460px', fontSize: '15.5px', lineHeight: 1.5, color: '#63676F', textAlign: 'center', textWrap: 'pretty', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .14s both'}}>
                  {homeSub}
                </span>
                <div data-tomenu="1" style={{position: 'relative', width: '100%', maxWidth: '640px', marginTop: '28px', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .2s both', zIndex: 6}}>
                  <div style={{position: 'relative', width: '100%', maxWidth: '640px', margin: '0 auto', borderRadius: '32px', background: '#FFFFFF', boxShadow: '0 1px 1px rgba(16,18,24,0.03), 0 8px 20px -8px rgba(16,18,24,0.10), 0 30px 60px -28px rgba(16,18,24,0.20), inset 0 0 0 1px rgba(16,18,24,0.055)'}}>
                    <span aria-hidden="true" style={css(beamMaskStyle)}>
                      <span style={css(beamStyle)}></span>
                      <span style={css(beamTrailStyle)}></span>
                      <span style={css(beamStyleB)}></span>
                      <span style={css(beamTrailStyleB)}></span>
                    </span>
                    <span aria-hidden="true" style={css(beamGlowStyle)}></span>
                    <div data-palette="1" style={css(paletteStyle)}>
                      <span style={{display: 'block', padding: '9px 12px 6px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#5F636B'}}>
                        {paletteHeading}
                      </span>
                      {noPal && (
                        <>
                        <span style={{display: 'block', padding: '6px 12px 12px', fontSize: '12.5px', color: '#63676F'}}>
                          No tools match that.
                        </span>
                        </>
                      )}
                      <div style={{display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain', maxHeight: '320px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent'}}>
                        {(paletteItems || []).map((c, idx) => (
                          <React.Fragment key={idx}>
                            <button className="mk19" onMouseDown={c.onPick} onMouseEnter={c.onEnter} style={css(c.style)}>
                              <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '9px', background: '#F1F2F4', color: '#3A3D44', flexShrink: 0}}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                  <path d={c.icon}></path>
                                </svg>
                              </span>
                              <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, textAlign: 'left', minWidth: 0}}>
                                <span style={{fontSize: '13px', fontWeight: 500, color: '#15171C', letterSpacing: '-0.008em'}}>
                                  {c.label}
                                </span>
                                <span style={{fontSize: '11px', color: '#63676F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {c.desc}
                                </span>
                              </span>
                              <span style={css(c.hintStyle)}>
                                Added
                              </span>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    <div style={{position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px 14px 12px 18px'}}>
                      {hasFiles && (
                        <>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '0 2px 2px'}}>
                          {(files || []).map((fl, idx) => (
                            <React.Fragment key={idx}>
                              <span className="mk20" style={css(fl.style)}>
                                <button onClick={fl.onOpen} title="Preview" style={{position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', borderRadius: '999px', background: 'transparent', cursor: 'pointer', padding: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}></button>
                                <span style={css(fl.thumbStyle)}>
                                  {fl.isImg && (
                                    <>
                                    <span style={css(fl.imgStyle)}></span>
                                    </>
                                  )}
                                  {fl.noImg && (
                                    <>
                                    {fl.ext}
                                    </>
                                  )}
                                </span>
                                <span style={{display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, pointerEvents: 'none'}}>
                                  <span style={{fontSize: '12.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '130px'}}>
                                    {fl.name}
                                  </span>
                                  <span style={{fontSize: '11px', color: '#63676F'}}>
                                    {fl.meta}
                                  </span>
                                </span>
                                <button className="mk21 mk22" onClick={fl.onRemove} title="Remove" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2, width: '18px', height: '18px', borderRadius: '999px', border: 'none', background: 'rgba(16,18,24,0.07)', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .26s cubic-bezier(.32,.72,0,1), color .18s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                                    <path d="M6 6l12 12M18 6L6 18"></path>
                                  </svg>
                                </button>
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        </>
                      )}
                      <div style={{position: 'relative', width: '100%'}}>
                        <div ref={mirrorRef} aria-hidden="true" style={{width: '100%', border: 'none', fontFamily: 'inherit', fontSize: '15.5px', lineHeight: '24px', height: '48px', letterSpacing: '-0.011em', padding: '0 4px', boxSizing: 'border-box', position: 'absolute', left: 0, top: 0, pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden', color: '#15171C'}}>
                          {(inputParts || []).map((p, idx) => (
                            <React.Fragment key={idx}>
                              {p.isTok && (
                                <>
                                <span key={p.key} style={css(p.tokStyle)}>
                                  <span style={{display: 'inline-block', width: '1em', textAlign: 'left', verticalAlign: '-2px', color: '#15171C'}}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d={p.icon}></path>
                                    </svg>
                                  </span>
                                  {p.label}
                                </span>
                                </>
                              )}
                              {p.isText && (
                                <>
                                {p.text}
                                </>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                        <textarea ref={inputRef} rows={2} placeholder={homePlaceholder} value={text} onChange={onText} onKeyDown={onKey} onSelect={onCaret} onKeyUp={onCaret} onClick={onCaret} onScroll={onTaScroll} style={{width: '100%', border: 'none', background: 'transparent', resize: 'none', fontFamily: 'inherit', fontSize: '15.5px', lineHeight: '24px', height: '48px', letterSpacing: '-0.011em', padding: '0 4px', boxSizing: 'border-box', position: 'relative', color: 'transparent', caretColor: '#15171C'}}></textarea>
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap'}}>
                          <button className="mk23 mk24" title="Add files" onClick={pickFiles} style={{width: '34px', height: '34px', borderRadius: '999px', border: '1px solid transparent', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#5C6069', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .2s cubic-bezier(.2,.8,.3,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                              <path d="M12 5v14M5 12h14"></path>
                            </svg>
                          </button>
                          <button className="mk26 mk16" onClick={toggleHomeMenu} title="Choose who to message" style={css(toBtnStyle)}>
                            <span style={{display: 'flex', alignItems: 'center'}}>
                              {(homeToAvs || []).map((v, idx) => (
                                <React.Fragment key={idx}>
                                  <span style={css(v.wrap)}>
                                    <MockBloub shape="cercle" color={v.color} size="20" busy={v.busy} />
                                  </span>
                                </React.Fragment>
                              ))}
                            </span>
                            <span style={{maxWidth: '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                              {homeToName}
                            </span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={css(toChevStyle)}>
                              <path d="M6 9l6 6 6-6"></path>
                            </svg>
                          </button>
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                          <button className="mk1 mk3" title="Dictate" style={{width: '34px', height: '34px', borderRadius: '999px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'transparent', color: '#5C6069', transition: 'background .3s cubic-bezier(.2,.8,.3,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                              <rect x="9" y="3" width="6" height="11" rx="3"></rect>
                              <path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path>
                            </svg>
                          </button>
                          <button className="mk25 mk3" title="Send" onClick={onSend} style={css(sendStyle)}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 19V6M6 12l6-6 6 6"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={css(homeMenuStyle)}>
                    {hasAgentOpts && (
                      <>
                      <span style={{display: 'block', padding: '9px 12px 6px', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A8E96'}}>
                        Agents
                      </span>
                      </>
                    )}
                    {noAgents && (
                      <>
                      <span style={{display: 'block', padding: '12px 12px 8px', fontSize: '13px', lineHeight: 1.45, color: '#63676F'}}>
                        You don't have any agents yet. Make one to start chatting.
                      </span>
                      </>
                    )}
                    <div style={{display: 'flex', flexDirection: 'column', maxHeight: '260px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent'}}>
                      {(homeAgentOpts || []).map((o, idx) => (
                        <React.Fragment key={idx}>
                          <button className="mk1" onClick={o.onPick} style={css(o.style)}>
                            <MockBloub shape="cercle" color={o.color} size="24" busy={o.busy} />
                            <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0, textAlign: 'left'}}>
                              <span style={{fontSize: '13.5px', fontWeight: 700, color: '#15171C'}}>
                                {o.name}
                              </span>
                              <span style={{fontSize: '12px', color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                {o.sub}
                              </span>
                            </span>
                            {o.on && (
                              <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E6FFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6L9 17l-5-5"></path>
                              </svg>
                              </>
                            )}
                          </button>
                        </React.Fragment>
                      ))}
                      {hasGroupOpts && (
                        <>
                        <span style={{display: 'block', padding: '12px 12px 6px', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A8E96'}}>
                          Group chats
                        </span>
                        {(homeGroupOpts || []).map((o, idx) => (
                          <React.Fragment key={idx}>
                            <button className="mk1" onClick={o.onPick} style={css(o.style)}>
                              <span style={{position: 'relative', display: 'flex', width: '26px', height: '26px', flexShrink: 0}}>
                                <span style={{position: 'absolute', left: 0, top: 0, display: 'flex'}}>
                                  <MockBloub shape="cercle" color={o.c1} size="17" busy="false" />
                                </span>
                                <span style={{position: 'absolute', right: 0, bottom: 0, display: 'flex'}}>
                                  <MockBloub shape="cercle" color={o.c2} size="17" busy="false" />
                                </span>
                              </span>
                              <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0, textAlign: 'left'}}>
                                <span style={{fontSize: '13.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {o.name}
                                </span>
                                <span style={{fontSize: '12px', color: '#7A7E87'}}>
                                  {o.sub}
                                </span>
                              </span>
                              {o.on && (
                                <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E6FFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 6L9 17l-5-5"></path>
                                </svg>
                                </>
                              )}
                            </button>
                          </React.Fragment>
                        ))}
                        </>
                      )}
                    </div>
                    {hasAgentOpts && (
                      <>
                      <span style={{display: 'block', height: '1px', margin: '4px 8px', background: 'rgba(16,18,24,0.07)'}}></span>
                      </>
                    )}
                    <button className="mk1" onMouseDown={homeNewGroup} style={{display: 'flex', alignItems: 'center', gap: '10px', width: '100%', height: '36px', padding: '0 10px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 700, color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{color: '#5F636B'}}>
                        <path d="M12 5v14M5 12h14"></path>
                      </svg>
                      {homeMenuActionLabel}
                    </button>
                  </div>
                </div>
                <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px', marginTop: '14px', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .26s both'}}>
                  {(homeIdeas || []).map((i, idx) => (
                    <React.Fragment key={idx}>
                      <button className="mk15 mk16" onClick={i.onPick} style={{display: 'flex', alignItems: 'center', gap: '7px', height: '32px', padding: '0 13px 0 10px', borderRadius: '999px', border: 'none', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 400, color: '#3A3D44', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.08)', transition: 'background .22s ease, box-shadow .22s ease, transform .22s cubic-bezier(.16,1,.3,1), color .22s ease'}}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: '#1E6FFF'}}>
                          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path>
                        </svg>
                        {i.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                {hasAgents && (
                  <>
                  {hasNeeds && (
                    <>
                    <div style={{display: 'flex', flexDirection: 'column', width: '100%', marginTop: '40px', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .28s both'}}>
                      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 10px'}}>
                        <span style={{fontSize: '13px', fontWeight: 700, color: '#15171C'}}>
                          Needs you
                        </span>
                        <span style={{fontSize: '12px', color: '#9DA1A9'}}>
                          {needsCount}
                        </span>
                      </div>
                      <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        {(needs || []).map((n, idx) => (
                          <React.Fragment key={idx}>
                            <button className="mk27" onClick={n.onOpen} style={{display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '9px 10px', borderRadius: '12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'background .28s cubic-bezier(.32,.72,0,1)'}}>
                              <MockBloub shape="cercle" color={n.color} size="26" busy="false" />
                              <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0}}>
                                <span style={{fontSize: '13.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {n.title}
                                </span>
                                <span style={{fontSize: '12.5px', color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {n.sub}
                                </span>
                              </span>
                              <span style={css(n.tagStyle)}>
                                {n.tag}
                              </span>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    </>
                  )}
                  <div style={{display: 'flex', flexDirection: 'column', width: '100%', marginTop: '48px', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .32s both'}}>
                    <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 10px'}}>
                      <span style={{fontSize: '13px', fontWeight: 700, color: '#15171C'}}>
                        Latest activity
                      </span>
                      <span style={{fontSize: '12px', color: '#9DA1A9'}}>
                        {feedCount}
                      </span>
                    </div>
                    {feedEmpty && (
                      <>
                      <span style={{display: 'block', padding: '14px 4px', fontSize: '13px', lineHeight: 1.5, color: '#9DA1A9'}}>
                        Activity shows up here once an agent starts working.
                      </span>
                      </>
                    )}
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '8px'}}>
                      {(feed || []).map((f, idx) => (
                        <React.Fragment key={idx}>
                          <button className="mk28 mk6" onClick={f.onOpen} style={{display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, padding: '12px 14px', borderRadius: '16px', border: 'none', background: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.06)', transition: 'background .24s ease, box-shadow .24s ease, transform .3s cubic-bezier(.16,1,.3,1)'}}>
                            <span style={{display: 'flex', alignItems: 'center', gap: '9px', width: '100%'}}>
                              <MockBloub shape="cercle" color={f.color} size="22" busy={f.busy} />
                              <span style={{flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                {f.name}
                              </span>
                              <span style={{fontSize: '11.5px', color: '#9DA1A9', fontVariantNumeric: 'tabular-nums'}}>
                                {f.time}
                              </span>
                            </span>
                            <span style={css(f.labelStyle)}>
                              {f.label}
                            </span>
                            <span style={{display: 'flex', alignItems: 'center', gap: '8px', width: '100%'}}>
                              <span style={{flex: 1, height: '3px', borderRadius: '999px', background: 'rgba(16,18,24,0.07)', overflow: 'hidden'}}>
                                <span style={css(f.barStyle)}></span>
                              </span>
                              <span style={{fontSize: '11.5px', color: '#7A7E87', fontVariantNumeric: 'tabular-nums'}}>
                                {f.progress}
                              </span>
                            </span>
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  </>
                )}
                {noAgents && (
                  <>
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: '36px', animation: 'clyraThinkIn .7s cubic-bezier(.32,.72,0,1) .3s both'}}>
                    <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '12px', padding: '0 4px 10px'}}>
                      <span style={{fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A8ACB4'}}>
                        Or start from
                      </span>
                      <button className="mk29" onClick={openMarket} style={{border: 'none', background: 'transparent', padding: '4px 8px', margin: '-4px -8px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: 700, color: '#1E6FFF', transition: 'background .28s cubic-bezier(.32,.72,0,1)'}}>
                        Browse all
                      </button>
                    </div>
                    <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px'}}>
                      {(featTpls || []).map((t, idx) => (
                        <React.Fragment key={idx}>
                          <button className="mk1 mk16" onClick={t.onPrefill} style={{display: 'flex', alignItems: 'center', gap: '8px', height: '36px', padding: '0 14px 0 7px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 700, color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                            <MockBloub shape="cercle" color={t.color} size="22" busy="false" />
                            {t.name}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  </>
                )}
              </div>
            </div>
          </div>
          </>
        )}
        {inMarket && (
          <>
          <div style={{flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent', animation: 'clyraChatIn .5s cubic-bezier(.32,.72,0,1) both'}}>
            <div style={{display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '1040px', margin: '0 auto', padding: '18px 32px 64px', boxSizing: 'border-box'}}>
              <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap'}}>
                <span style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                  <span style={{fontSize: '12px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9DA1A9'}}>
                    {mEyebrow}
                  </span>
                  <span style={{fontSize: '34px', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.05, color: '#15171C'}}>
                    Marketplace
                  </span>
                </span>
                <label className="mk30" style={{display: 'flex', alignItems: 'center', gap: '9px', width: 'min(340px, 100%)', height: '40px', padding: '0 14px', borderRadius: '999px', background: 'rgba(16,18,24,0.045)', cursor: 'text', transition: 'background .28s cubic-bezier(.32,.72,0,1), box-shadow .28s ease'}}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{color: '#8A8E96', flexShrink: 0}}>
                    <circle cx="11" cy="11" r="6.6"></circle>
                    <path d="M16 16l4 4"></path>
                  </svg>
                  <input type="text" placeholder="Search 43 agents" value={mq} onChange={onMq} style={{flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: '14px', color: '#15171C'}} />
                  {mHasQ && (
                    <>
                    <button className="mk31" onClick={clearMq} title="Clear" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '999px', border: 'none', background: 'rgba(16,18,24,0.12)', cursor: 'pointer', color: '#FFFFFF', padding: 0, transition: 'background .28s ease'}}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18"></path>
                      </svg>
                    </button>
                    </>
                  )}
                </label>
              </div>
              <div style={{display: 'flex', gap: '4px', margin: '22px -4px 0', overflowX: 'auto', scrollbarWidth: 'none'}}>
                {(mcats || []).map((c, idx) => (
                  <React.Fragment key={idx}>
                    <button className="mk32 mk16" onClick={c.onPick} style={css(c.style)}>
                      {c.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              {mBrowse && (
                <>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginTop: '22px'}}>
                  {(mHero || []).map((h, idx) => (
                    <React.Fragment key={idx}>
                      <div className="mk33" onClick={h.onOpen} style={css(h.heroStyle)}>
                        <span style={css(h.glowStyle)}></span>
                        <span style={{position: 'relative', fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(16,18,24,0.5)'}}>
                          {h.kicker}
                        </span>
                        <span style={{position: 'relative', display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '18px 0 14px'}}>
                          <MockBloub shape="cercle" color={h.color} size="84" busy="false" />
                        </span>
                        <span style={{position: 'relative', display: 'flex', alignItems: 'flex-end', gap: '12px'}}>
                          <span style={{display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0}}>
                            <span style={{fontSize: '19px', fontWeight: 700, letterSpacing: '-0.02em', color: '#15171C'}}>
                              {h.name}
                            </span>
                            <span style={{fontSize: '13px', lineHeight: 1.4, color: 'rgba(16,18,24,0.62)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
                              {h.tagline}
                            </span>
                          </span>
                          <button className="mk5" onClick={h.onAdd} style={css(h.getStyle)}>
                            {h.installing && (
                              <>
                              <svg width="28" height="28" viewBox="0 0 26 26" style={{animation: 'clyraRise .25s cubic-bezier(.16,1,.3,1) both'}}>
                                <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(30,111,255,0.16)" strokeWidth="2.2"></circle>
                                <g style={{transformOrigin: '13px 13px', animation: 'clyraInstSpin .45s linear 1'}}>
                                  <circle cx="13" cy="13" r="10" fill="none" stroke="#1E6FFF" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="62.8" strokeDashoffset="62.8" transform="rotate(-90 13 13)" style={{animation: 'clyraInstFill 1.2s .4s cubic-bezier(.5,.05,.3,1) forwards'}}></circle>
                                </g>
                                <rect x="10" y="10" width="6" height="6" rx="1.5" fill="#1E6FFF"></rect>
                              </svg>
                              </>
                            )}
                            {h.idle && (
                              <>
                              {h.getLabel}
                              </>
                            )}
                          </button>
                        </span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                {(mShelves || []).map((sh, idx) => (
                  <React.Fragment key={idx}>
                    <div style={{display: 'flex', flexDirection: 'column', marginTop: '40px'}}>
                      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(16,18,24,0.07)'}}>
                        <span style={{display: 'flex', alignItems: 'baseline', gap: '10px'}}>
                          <span style={{fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: '#15171C'}}>
                            {sh.title}
                          </span>
                          <span style={{fontSize: '13px', color: '#9DA1A9'}}>
                            {sh.sub}
                          </span>
                        </span>
                        <button className="mk29" onClick={sh.onSeeAll} style={{border: 'none', background: 'transparent', padding: '4px 10px', marginRight: '-10px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 700, color: '#1E6FFF', transition: 'background .28s cubic-bezier(.32,.72,0,1)'}}>
                          See all
                        </button>
                      </div>
                      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', columnGap: '36px', paddingTop: '6px'}}>
                        {(sh.items || []).map((t, idx) => (
                          <React.Fragment key={idx}>
                            <div className="mk34" onClick={t.onOpen} style={{display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, padding: '12px 12px', margin: '0 -12px', borderRadius: '18px', cursor: 'pointer', transition: 'background .28s cubic-bezier(.32,.72,0,1)', animation: 'clyraActIn .4s cubic-bezier(.2,.8,.3,1) both'}}>
                              <span style={css(t.tileStyle)}>
                                <MockBloub shape="cercle" color={t.color} size="34" busy="false" />
                              </span>
                              <span style={{display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, paddingBottom: '12px', marginBottom: '-12px', boxShadow: 'inset 0 -1px 0 rgba(16,18,24,0.06)'}}>
                                <span style={{fontSize: '14.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {t.name}
                                </span>
                                <span style={{fontSize: '13px', color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {t.tagline}
                                </span>
                              </span>
                              <button className="mk5" onClick={t.onAdd} style={css(t.getStyle)}>
                                {t.installing && (
                                  <>
                                  <svg width="28" height="28" viewBox="0 0 26 26" style={{animation: 'clyraRise .25s cubic-bezier(.16,1,.3,1) both'}}>
                                    <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(30,111,255,0.16)" strokeWidth="2.2"></circle>
                                    <g style={{transformOrigin: '13px 13px', animation: 'clyraInstSpin .45s linear 1'}}>
                                      <circle cx="13" cy="13" r="10" fill="none" stroke="#1E6FFF" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="62.8" strokeDashoffset="62.8" transform="rotate(-90 13 13)" style={{animation: 'clyraInstFill 1.2s .4s cubic-bezier(.5,.05,.3,1) forwards'}}></circle>
                                    </g>
                                    <rect x="10" y="10" width="6" height="6" rx="1.5" fill="#1E6FFF"></rect>
                                  </svg>
                                  </>
                                )}
                                {t.idle && (
                                  <>
                                  {t.getLabel}
                                  </>
                                )}
                              </button>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                </>
              )}
              {mFiltered && (
                <>
                <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '28px', paddingBottom: '6px', borderBottom: '1px solid rgba(16,18,24,0.07)'}}>
                  <span style={{fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: '#15171C'}}>
                    {mFilterTitle}
                  </span>
                  <span style={{fontSize: '13px', color: '#9DA1A9', fontVariantNumeric: 'tabular-nums'}}>
                    {mResultLabel}
                  </span>
                </div>
                {mEmpty && (
                  <>
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', textAlign: 'center', animation: 'clyraFade .3s ease both'}}>
                    <MockBloub shape="cercle" color="gris" size="44" busy="false" />
                    <span style={{marginTop: '14px', fontSize: '15px', fontWeight: 700, color: '#15171C'}}>
                      Nothing matches that
                    </span>
                    <span style={{marginTop: '4px', fontSize: '13.5px', color: '#7A7E87'}}>
                      Try another word, or browse a category.
                    </span>
                  </div>
                  </>
                )}
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', columnGap: '36px', paddingTop: '6px'}}>
                  {(mItems || []).map((t, idx) => (
                    <React.Fragment key={idx}>
                      <div className="mk34" onClick={t.onOpen} style={{display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, padding: '12px 12px', margin: '0 -12px', borderRadius: '18px', cursor: 'pointer', transition: 'background .28s cubic-bezier(.32,.72,0,1)', animation: 'clyraActIn .4s cubic-bezier(.2,.8,.3,1) both'}}>
                        <span style={css(t.tileStyle)}>
                          <MockBloub shape="cercle" color={t.color} size="34" busy="false" />
                        </span>
                        <span style={{display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, paddingBottom: '12px', marginBottom: '-12px', boxShadow: 'inset 0 -1px 0 rgba(16,18,24,0.06)'}}>
                          <span style={{fontSize: '14.5px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {t.name}
                          </span>
                          <span style={{fontSize: '13px', color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {t.tagline}
                          </span>
                        </span>
                        <button className="mk5" onClick={t.onAdd} style={css(t.getStyle)}>
                          {t.installing && (
                            <>
                            <svg width="28" height="28" viewBox="0 0 26 26" style={{animation: 'clyraRise .25s cubic-bezier(.16,1,.3,1) both'}}>
                              <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(30,111,255,0.16)" strokeWidth="2.2"></circle>
                              <g style={{transformOrigin: '13px 13px', animation: 'clyraInstSpin .45s linear 1'}}>
                                <circle cx="13" cy="13" r="10" fill="none" stroke="#1E6FFF" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="62.8" strokeDashoffset="62.8" transform="rotate(-90 13 13)" style={{animation: 'clyraInstFill 1.2s .4s cubic-bezier(.5,.05,.3,1) forwards'}}></circle>
                              </g>
                              <rect x="10" y="10" width="6" height="6" rx="1.5" fill="#1E6FFF"></rect>
                            </svg>
                            </>
                          )}
                          {t.idle && (
                            <>
                            {t.getLabel}
                            </>
                          )}
                        </button>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                </>
              )}
            </div>
          </div>
          </>
        )}
      </main>
      <div style={css(paneWrapStyle)}>
        <section style={css(paneInnerStyle)}>
          <div style={{display: 'flex', alignItems: 'center', height: '48px', padding: '0 10px', flexShrink: 0}}>
            <button className="mk4 mk5" onClick={togglePane} title={paneTitle} style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#5F636B', flexShrink: 0, transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={css(paneIconA)}>
                <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                <path d="M15 4v16"></path>
              </svg>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={css(paneIconB)}>
                <path d="M9.5 6.5L15 12l-5.5 5.5"></path>
              </svg>
            </button>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', padding: '0 16px 0', flexShrink: 0}}>
            <div style={{position: 'relative', width: '100%', aspectRatio: '4 / 3', maxHeight: '40vh', borderRadius: '16px', background: '#F6F7F8', overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07), 0 1px 2px rgba(16,18,24,0.03)'}}>
              <MockViewport mode={vpMode} cursors={vpCursors} style="position:absolute; inset:0; border-radius:16px;" />
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 2px 0'}}>
              <span style={{display: 'flex', alignItems: 'center', flexShrink: 0}}>
                {(vpAvs || []).map((v, idx) => (
                  <React.Fragment key={idx}>
                    <span style={css(v.wrap)}>
                      <MockBloub shape="cercle" color={v.color} size="26" busy={v.busy} />
                    </span>
                  </React.Fragment>
                ))}
              </span>
              <span style={{display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0}}>
                <span style={{fontSize: '14px', fontWeight: 700, letterSpacing: '-0.008em', color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  {vpTitle}
                </span>
                <span style={{display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0}}>
                  {viewLive && (
                    <>
                    <span style={{position: 'relative', display: 'flex', width: '6px', height: '6px', flexShrink: 0, animation: 'clyraFade .24s ease both'}}>
                      <span style={{position: 'absolute', inset: 0, borderRadius: '50%', background: '#1E6FFF', animation: 'clyraPulse 1.9s cubic-bezier(.2,.8,.3,1) infinite'}}></span>
                      <span style={{position: 'relative', display: 'block', width: '6px', height: '6px', borderRadius: '50%', background: '#1E6FFF'}}></span>
                    </span>
                    </>
                  )}
                  <span style={{fontSize: '12.5px', color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {vpStatus}
                  </span>
                </span>
              </span>
              {canTakeover && (
                <>
                <button className="mk35 mk9" onClick={toggleTakeover} style={{height: '28px', padding: '0 12px', borderRadius: '999px', border: 'none', background: '#15171C', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: 600, color: '#FFFFFF', flexShrink: 0, animation: 'clyraFade .24s ease both', transition: 'transform .22s cubic-bezier(.32,.72,0,1), filter .2s ease'}}>
                  {takeoverLabel}
                </button>
                </>
              )}
            </div>
            {multiTabs && (
              <>
              <div style={{display: 'flex', gap: '2px', padding: '3px', marginTop: '14px', borderRadius: '999px', background: '#F1F2F4'}}>
                {(tabs || []).map((t, idx) => (
                  <React.Fragment key={idx}>
                    <button onClick={t.onPick} style={css(t.style)}>
                      {t.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              </>
            )}
            <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '26px 2px 8px'}}>
              <span style={{fontSize: '12px', fontWeight: 600, color: '#15171C', letterSpacing: '-0.004em'}}>
                Actions
              </span>
              <span style={{fontSize: '11.5px', color: '#9DA1A9', fontVariantNumeric: 'tabular-nums'}}>
                {actionCount}
              </span>
            </div>
          </div>
          <div ref={paneScrollRef} style={{flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '6px 16px 32px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.12) transparent', WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 28px), transparent 100%)', maskImage: 'linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 28px), transparent 100%)'}}>
            {noActions && (
              <>
              <span style={{display: 'block', padding: '2px 2px', fontSize: '12.5px', lineHeight: 1.5, color: '#A8ACB4'}}>
                Nothing yet. Steps appear here as the agent works.
              </span>
              </>
            )}
            <div style={{display: 'flex', flexDirection: 'column'}}>
              {(actions || []).map((a, idx) => (
                <React.Fragment key={idx}>
                  <div data-active={a.activeAttr} style={{position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '0 2px 14px', animation: 'clyraActIn .3s cubic-bezier(.2,.8,.3,1) both'}}>
                    {a.hasLine && (
                      <>
                      <span style={{position: 'absolute', left: '9px', top: '19px', bottom: '1px', width: '1px', background: 'rgba(16,18,24,0.08)'}}></span>
                      </>
                    )}
                    <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '19px', flexShrink: 0}}>
                      {a.done && (
                        <>
                        <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', borderRadius: '999px', background: '#EEEFF1', animation: 'clyraFade .24s ease both'}}>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#5F636B" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5"></path>
                          </svg>
                        </span>
                        </>
                      )}
                      {a.active && (
                        <>
                        <span style={{position: 'relative', display: 'flex', width: '7px', height: '7px', animation: 'clyraFade .24s ease both'}}>
                          <span style={{position: 'absolute', inset: 0, borderRadius: '50%', background: '#15171C', animation: 'clyraPulse 1.9s cubic-bezier(.2,.8,.3,1) infinite'}}></span>
                          <span style={{position: 'relative', display: 'block', width: '7px', height: '7px', borderRadius: '50%', background: '#15171C'}}></span>
                        </span>
                        </>
                      )}
                      {a.queued && (
                        <>
                        <span style={{display: 'block', width: '6px', height: '6px', borderRadius: '999px', boxShadow: 'inset 0 0 0 1.2px #CDD0D5'}}></span>
                        </>
                      )}
                      {a.paused && (
                        <>
                        <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5px', width: '14px', height: '14px', borderRadius: '999px', background: '#F1F2F4'}}>
                          <span style={{display: 'block', width: '1.6px', height: '5.5px', borderRadius: '1px', background: '#7A7E87'}}></span>
                          <span style={{display: 'block', width: '1.6px', height: '5.5px', borderRadius: '1px', background: '#7A7E87'}}></span>
                        </span>
                        </>
                      )}
                    </span>
                    <span style={css(a.labelStyle)}>
                      {a.label}
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div onClick={closeTpl} style={css(tplOverlayStyle)}>
        <div onClick={stop} style={css(tplCardStyle)}>
          <div style={{display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '22px 22px 18px'}}>
            <MockBloub shape="cercle" color={tplColor} size="48" busy="false" />
            <span style={{display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0}}>
              <span style={{fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: '#15171C'}}>
                {tplName}
              </span>
              <span style={{fontSize: '13px', color: '#7A7E87'}}>
                {tplCat}
              </span>
            </span>
            <button className="mk36 mk5" onClick={closeTpl} title="Close" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '999px', border: 'none', background: 'rgba(16,18,24,0.05)', cursor: 'pointer', color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18"></path>
              </svg>
            </button>
          </div>
          <div style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 22px 20px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(16,18,24,0.14) transparent'}}>
            <span style={{display: 'block', fontSize: '15px', lineHeight: 1.55, color: '#3A3D44', textWrap: 'pretty'}}>
              {tplTagline}
            </span>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '12px'}}>
              {(tplCaps || []).map((k, idx) => (
                <React.Fragment key={idx}>
                  <span style={{height: '24px', padding: '0 9px', display: 'flex', alignItems: 'center', borderRadius: '7px', background: '#F3F4F6', fontSize: '12px', color: '#5F636B'}}>
                    {k}
                  </span>
                </React.Fragment>
              ))}
            </div>
            <div style={{marginTop: '22px', borderRadius: '18px', background: '#F7F8FA', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.05)', padding: '18px 18px 6px'}}>
              <span style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A8E96'}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 8l-4 4 4 4M16 8l4 4-4 4"></path>
                </svg>
                System prompt
              </span>
              <span style={{display: 'block', marginTop: '12px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Role
              </span>
              <span style={{display: 'block', marginTop: '4px', fontSize: '13.5px', lineHeight: 1.55, color: '#3A3D44'}}>
                {tplRole}
              </span>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Goals
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                {(tplGoals || []).map((g, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{display: 'flex', gap: '9px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                      <span style={{flexShrink: 0, width: '5px', height: '5px', marginTop: '8px', borderRadius: '999px', background: '#1E6FFF'}}></span>
                      {g}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                How it works
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px'}}>
                {(tplSteps || []).map((w, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{display: 'flex', gap: '10px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                      <span style={{flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '999px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.1)', fontSize: '11px', fontWeight: 700, color: '#15171C'}}>
                        {w.n}
                      </span>
                      {w.text}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Rules
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                {(tplRules || []).map((r, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{display: 'flex', gap: '9px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8E96" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, marginTop: '3px'}}>
                        <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"></path>
                      </svg>
                      {r}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Stops and asks when
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                {(tplAsk || []).map((r, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{display: 'flex', gap: '9px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                      <span style={{flexShrink: 0, width: '5px', height: '5px', marginTop: '8px', borderRadius: '999px', background: '#E0A11B'}}></span>
                      {r}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Quality bar
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                {(tplQuality || []).map((r, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{display: 'flex', gap: '9px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1F8A55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, marginTop: '3px'}}>
                        <path d="M5 12.5l4.5 4.5L19 7.5"></path>
                      </svg>
                      {r}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Tone
              </span>
              <span style={{display: 'block', marginTop: '4px', fontSize: '13.5px', lineHeight: 1.55, color: '#3A3D44'}}>
                {tplTone}
              </span>
              {(tplExtra || []).map((sec, idx) => (
                <React.Fragment key={idx}>
                  <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                    {sec.title}
                  </span>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px'}}>
                    {(sec.items || []).map((it, idx) => (
                      <React.Fragment key={idx}>
                        <span style={{display: 'flex', gap: '9px', fontSize: '13.5px', lineHeight: 1.5, color: '#3A3D44'}}>
                          <span style={{flexShrink: 0, width: '5px', height: '5px', marginTop: '8px', borderRadius: '999px', background: '#8A6CF0'}}></span>
                          {it}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </React.Fragment>
              ))}
              <span style={{display: 'block', marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#15171C'}}>
                Output
              </span>
              <span style={{display: 'block', margin: '6px 0 12px', fontSize: '13.5px', lineHeight: 1.55, color: '#3A3D44'}}>
                {tplOutput}
              </span>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 22px 18px', borderTop: '1px solid rgba(16,18,24,0.06)'}}>
            <span style={{flex: 1, minWidth: 0, fontSize: '12.5px', lineHeight: 1.4, color: '#7A7E87', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
              {tplJob}
            </span>
            <button className="mk16" onClick={tplAdd} style={css(tplAddStyle)}>
              {tplInstalling && (
                <>
                <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <svg width="18" height="18" viewBox="0 0 26 26">
                    <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.6"></circle>
                    <circle cx="13" cy="13" r="10" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="62.8" strokeDashoffset="62.8" transform="rotate(-90 13 13)" style={{animation: 'clyraInstFill 1.2s .4s cubic-bezier(.5,.05,.3,1) forwards'}}></circle>
                  </svg>
                  Getting ready
                </span>
                </>
              )}
              {tplIdle && (
                <>
                {tplAddLabel}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      <input type="file" multiple ref={fileRef} onChange={onFiles} style={{display: 'none'}} />
      <div onClick={closePreview} style={css(previewOverlayStyle)}>
        <div onClick={stop} style={css(previewCardStyle)}>
          <div style={{display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 12px 12px 14px', borderBottom: '1px solid rgba(16,18,24,0.07)'}}>
            <span style={css(pvThumbStyle)}>
              {pvExt}
            </span>
            <span style={{display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0}}>
              <span style={{fontSize: '14px', fontWeight: 700, color: '#15171C', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {pvName}
              </span>
              <span style={{fontSize: '12px', color: '#63676F'}}>
                {pvMeta}
              </span>
            </span>
            {pvHasUrl && (
              <>
              <a className="mk37 mk5" ref={pvMediaRef} href="#" download={pvName} title="Download" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '999px', background: 'rgba(16,18,24,0.05)', color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"></path>
                </svg>
              </a>
              </>
            )}
            <button className="mk36 mk5" onClick={closePreview} title="Close" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '999px', border: 'none', background: 'rgba(16,18,24,0.05)', cursor: 'pointer', color: '#15171C', transition: 'background .28s cubic-bezier(.32,.72,0,1), transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18"></path>
              </svg>
            </button>
          </div>
          <div style={{position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px', background: '#F7F8FA', overflow: 'hidden'}}>
            {pvImg && (
              <>
              <span style={css(pvImgStyle)}></span>
              </>
            )}
            {pvVideo && (
              <>
              <video ref={pvMediaRef} controls style={{maxWidth: '100%', maxHeight: '100%', borderRadius: '14px', background: '#000', boxShadow: '0 20px 50px -24px rgba(16,18,24,0.5)'}}></video>
              </>
            )}
            {pvAudio && (
              <>
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', width: 'min(420px, 100%)', padding: '28px', borderRadius: '26px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07), 0 18px 40px -22px rgba(16,18,24,0.4)'}}>
                <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '999px', background: 'rgba(30,111,255,0.08)', color: '#1E6FFF'}}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V6l11-2v12"></path>
                    <circle cx="6.5" cy="18" r="2.5"></circle>
                    <circle cx="17.5" cy="16" r="2.5"></circle>
                  </svg>
                </span>
                <audio ref={pvMediaRef} controls style={{width: '100%'}}></audio>
              </div>
              </>
            )}
            {pvPdf && (
              <>
              <iframe ref={pvMediaRef} title={pvName} style={{width: '100%', height: '100%', border: 'none', borderRadius: '14px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07)'}}></iframe>
              </>
            )}
            {pvText && (
              <>
              <pre style={{width: '100%', height: '100%', margin: 0, padding: '20px 22px', boxSizing: 'border-box', overflow: 'auto', borderRadius: '16px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.07)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px', lineHeight: 1.6, color: '#2A2D33', whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>
                {pvTextBody}
              </pre>
              </>
            )}
            {pvOther && (
              <>
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', color: '#63676F', fontSize: '13.5px', textAlign: 'center'}}>
                <span style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '104px', height: '132px', borderRadius: '18px', background: '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.08), 0 18px 40px -22px rgba(16,18,24,0.4)', fontSize: '16px', fontWeight: 700, letterSpacing: '0.04em', color: '#5F636B'}}>
                  {pvExt}
                </span>
                <span>
                  {pvOtherNote}
                </span>
              </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div onMouseDown={scrimDown} style={css(scrimStyle)}>
        <div data-sheet="1" style={css(sheetStyle)}>
          <div style={{display: 'flex', alignItems: 'center', gap: '14px', padding: '22px 22px 16px'}}>
            <span key={previewKey} style={{display: 'flex', animation: 'clyraPop .45s cubic-bezier(.16,1,.3,1) both'}}>
              <MockBloub shape="cercle" color={dColor} size="52" busy="false" />
            </span>
            <span style={{display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0}}>
              <span style={{fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {draftTitle}
              </span>
              <span style={{fontSize: '13px', color: '#63676F'}}>
                {sheetSub}
              </span>
            </span>
            <button className="mk38" onClick={closeCreate} title="Close" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '999px', border: 'none', background: '#F0F0F2', cursor: 'pointer', color: '#5F636B', alignSelf: 'flex-start', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18"></path>
              </svg>
            </button>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 22px 20px'}}>
            <label style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
              <span style={{fontSize: '12px', fontWeight: 500, color: '#5F636B'}}>
                Name
              </span>
              <input className="mk39" ref={nameRef} type="text" maxLength={28} placeholder="e.g. Research Assistant" value={draftName} onChange={onDraftName} style={{height: '42px', padding: '0 14px', border: 'none', borderRadius: '12px', background: '#F4F4F6', fontFamily: 'inherit', fontSize: '14.5px', color: '#15171C', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.05)', transition: 'background .28s cubic-bezier(.32,.72,0,1), box-shadow .2s ease'}} />
            </label>
            <label style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
              <span style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
                <span style={{fontSize: '12px', fontWeight: 500, color: '#5F636B'}}>
                  What should it do?
                </span>
                <span style={css(countStyle)}>
                  {promptCount}
                </span>
              </span>
              <textarea className="mk39" rows={promptRows} maxLength={8000} placeholder="Keep it short. e.g. Watch my inbox, flag anything from customers and draft replies." value={draftPrompt} onChange={onDraftPrompt} style={{padding: '11px 14px', border: 'none', borderRadius: '12px', background: '#F4F4F6', resize: 'none', maxHeight: '42vh', overflowY: 'auto', scrollbarWidth: 'thin', fontFamily: 'inherit', fontSize: '14px', lineHeight: 1.45, whiteSpace: 'pre-wrap', color: '#15171C', boxShadow: 'inset 0 0 0 1px rgba(16,18,24,0.05)', transition: 'background .28s cubic-bezier(.32,.72,0,1), box-shadow .2s ease'}}></textarea>
              {showStarters && (
                <>
                <span style={{display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '2px'}}>
                  {(starters || []).map((s, idx) => (
                    <React.Fragment key={idx}>
                      <button className="mk38" onClick={s.onPick} style={{height: '28px', padding: '0 11px', borderRadius: '999px', border: 'none', background: '#F0F0F2', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500, color: '#3A3D44', transition: 'background .26s cubic-bezier(.32,.72,0,1)'}}>
                        {s.label}
                      </button>
                    </React.Fragment>
                  ))}
                </span>
                </>
              )}
            </label>
            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
              <span style={{fontSize: '12px', fontWeight: 500, color: '#5F636B'}}>
                Color
              </span>
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                {(swatches || []).map((w, idx) => (
                  <React.Fragment key={idx}>
                    <button className="mk3" onClick={w.onPick} title={w.name} style={css(w.style)}></button>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '14px 22px 18px', borderTop: '1px solid rgba(16,18,24,0.06)'}}>
            <button className="mk40" onClick={closeCreate} style={{height: '38px', padding: '0 16px', borderRadius: '999px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13.5px', fontWeight: 500, color: '#3A3D44', transition: 'background .28s cubic-bezier(.32,.72,0,1), color .28s cubic-bezier(.32,.72,0,1), opacity .28s ease, transform .22s cubic-bezier(.32,.72,0,1)'}}>
              Cancel
            </button>
            <button className="mk16" onClick={saveAgent} style={css(createBtnStyle)}>
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
</>
  );
}
